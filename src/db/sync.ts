// src/db/sync.ts
//
// The local IndexedDB mirror is the single source the UI reads (via live
// queries — see src/hooks/useLiveData.ts). This module is the only writer that
// talks to the server, and it syncs by DELTAS:
//
//  - `reconcile` (first run, or when the server can't compute changes): record
//    the server's Email state, list every email id + flags (no bodies), prune
//    local rows the server no longer has, patch changed flags, download the
//    missing emails. Then store the state.
//  - `syncChanges` (every launch / push / poll): one request — Email/changes
//    since the stored state + the created emails + the updated flags + the
//    mailbox list. Nothing new costs one small round-trip.
//
// Triggers: `start()` (after sign-in), desktop push (Rust long-poll), a poll
// fallback, window focus/online, and explicit `syncNow()` (refresh buttons).
import {
  db,
  mailboxSortKeys,
  mailboxSortRange,
  splitEmail,
  type CachedBody,
  type CachedEmail,
} from './index'
import { jmapClient, JMAPClient } from '../api/jmap'
import { Email, Mailbox } from '../api/types'
import { config } from '../config'
import { useSyncStatusStore } from '../stores/syncStatusStore'
import { toast } from '../stores/toastStore'

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ')

/**
 * Build the lowercased haystack we search offline: subject, every address
 * (name + email) and the message body. This is what lets local search match
 * body content the way the server does, instead of only subject/preview.
 */
function buildSearchText(email: Email): string {
  const parts: string[] = []
  if (email.subject) parts.push(email.subject)
  if (email.preview) parts.push(email.preview)

  const addrs = [email.from, email.to, email.cc, email.bcc, email.replyTo]
  for (const list of addrs) {
    for (const a of list || []) {
      if (a?.name) parts.push(a.name)
      if (a?.email) parts.push(a.email)
    }
  }

  // Body text from whatever was fetched (text or html), tags stripped.
  for (const bv of Object.values(email.bodyValues || {})) {
    if (bv?.value) parts.push(stripHtml(bv.value))
  }

  // Bound the stored text so a huge mail can't bloat the index unreasonably.
  return parts.join(' ').replace(/\s+/g, ' ').toLowerCase().slice(0, 100_000)
}

const activeIds = (m: Record<string, boolean> | undefined) =>
  Object.keys(m || {}).filter((id) => m![id])

/** Same set of true keys (keywords / mailboxIds), order-insensitive. */
function sameFlags(a: Record<string, boolean> | undefined, b: Record<string, boolean> | undefined) {
  const x = activeIds(a).sort()
  const y = activeIds(b).sort()
  return x.length === y.length && x.every((k, i) => k === y[i])
}

const FLAG_PROPS = ['id', 'mailboxIds', 'keywords']
// Created emails per delta round (each carries its body, up to 256KB).
const MAX_CHANGES = 100
// Poll intervals: without push, and as a safety net while push is live.
const POLL_MS = 30_000
const POLL_WITH_PUSH_MS = 5 * 60_000
// Push counts as live if Rust reported a round within this window.
const PUSH_FRESH_MS = 6 * 60_000

/** Rows captured before an optimistic change, so a failed request can undo it. */
export interface CacheSnapshot {
  userId: string
  ids: string[]
  headers: CachedEmail[]
  bodies: CachedBody[]
}

export class SyncManager {
  private currentUserId: string | null = null
  // The local cache is a best-effort mirror of the server. On some platforms
  // (notably WebKitGTK in the desktop build) IndexedDB writes can fail with
  // "UnknownError: Unable to store record in object store" — a broken/quota'd
  // store. When that happens we must NOT let it break mail loading: we try one
  // reset+rebuild, and if that fails too we run cache-less for the session
  // (everything served straight from the server). These flags bound that.
  private cacheDisabled = false
  private recoveryAttempted = false
  private degradeNotified = false

  // Active sync loop (one account at a time).
  private active: { accountId: string; userId: string } | null = null
  private running: Promise<void> | null = null
  private rerun = false
  private pollTimer: number | null = null
  private lastPushAt = 0
  private detach: (() => void) | null = null

  /** True for storage faults where the cache is unusable (not a transient miss). */
  private isStorageFault(err: unknown): boolean {
    const m = err instanceof Error ? err.message : String(err)
    return /unable to store record|unknownerror|quota|object store|delete record from object store|modifying one or more objects|InvalidStateError|not a known object store|database is not open|corrupt/i.test(
      m
    )
  }

  /**
   * Central handler for an IndexedDB storage fault. First fault: reset the DB
   * and let the next sync rebuild it. Second fault: disable the cache for the
   * session. Never throws.
   */
  private async onStorageFault(err: unknown): Promise<void> {
    if (this.cacheDisabled) return
    console.error('[Sync] storage fault:', err)
    if (!this.recoveryAttempted && this.isStorageFault(err)) {
      this.recoveryAttempted = true
      await this.recoverDatabase()
      if (!this.degradeNotified) {
        this.degradeNotified = true
        toast.info('Local cache was reset and is rebuilding.')
      }
      return
    }
    this.cacheDisabled = true
    console.warn('[Sync] Local cache disabled for this session.')
    if (!this.degradeNotified) {
      this.degradeNotified = true
      toast.info('Local mail cache is unavailable — mail may load slowly and search may be incomplete.')
    }
  }

  private async recoverDatabase(): Promise<void> {
    console.error('[Sync] Local cache looks corrupted — resetting it (rebuilds from the server).')
    try {
      db.close()
      await db.delete()
      await db.open()
    } catch (e) {
      console.error('[Sync] Cache reset failed:', e)
    }
    // Live queries re-subscribe to the fresh DB; the next sync reconciles it.
    useSyncStatusStore.getState().bumpCacheGeneration()
    void this.syncNow()
  }

  /** A UI read hit a storage fault (see useCacheQuery). */
  async reportStorageFault(err: unknown): Promise<void> {
    await this.onStorageFault(err)
  }

  /** Best-effort cache write: swallow storage faults so callers never break. */
  private async safeWrite(op: () => Promise<unknown>): Promise<void> {
    if (this.cacheDisabled) return
    try {
      await op()
    } catch (err) {
      await this.onStorageFault(err)
    }
  }

  /** Best-effort cache read: return `fallback` instead of throwing on a fault. */
  private async safeRead<T>(op: () => Promise<T>, fallback: T): Promise<T> {
    if (this.cacheDisabled) return fallback
    try {
      return await op()
    } catch (err) {
      await this.onStorageFault(err)
      return fallback
    }
  }

  // --- user binding ---------------------------------------------------------

  async initializeUser(userId: string) {
    if (!userId || typeof userId !== 'string') throw new Error('Invalid user ID')
    if (userId.replace(/[^a-zA-Z0-9._@-]/g, '') !== userId) {
      throw new Error('User ID contains invalid characters')
    }
    if (userId.length > config.security.maxUserIdLength) throw new Error('User ID too long')

    this.currentUserId = userId
    // Best-effort: a broken store must not block sign-in / mail loading.
    await this.safeWrite(() => db.updateUserActivity(userId))
  }

  /** Bind to `userId` before a cache read/write (no-op when already bound). */
  async ensureUser(userId: string): Promise<void> {
    if (this.currentUserId !== userId) await this.initializeUser(userId)
  }

  getCurrentUserId(): string | null {
    return this.currentUserId
  }

  // --- cache writes -----------------------------------------------------------

  /**
   * Normalize a server Email into the shape we persist (user isolation, mailbox
   * sort keys, search haystack, sanitized preview/subject). Single source of
   * truth for every write path.
   */
  private toCached(email: Email, userId: string): CachedEmail & CachedBody {
    const mailboxIds = activeIds(email.mailboxIds)
    return {
      ...email,
      _syncedAt: Date.now(),
      _mailboxIds: mailboxIds,
      _mbSort: mailboxSortKeys(userId, mailboxIds, email.receivedAt),
      _userId: userId,
      _searchText: buildSearchText(email),
      preview: email.preview?.replace(/<[^>]*>/g, '').substring(0, config.security.maxPreviewLength) || '',
      subject: email.subject?.replace(/<[^>]*>/g, '').substring(0, config.security.maxSubjectLength) || '',
    }
  }

  /** Persist full emails (header + body rows). */
  async storeEmails(emails: Email[], userId: string): Promise<void> {
    if (emails.length === 0) return
    const split = emails.map((e) => splitEmail(this.toCached(e, userId)))
    await this.safeWrite(() =>
      db.transaction('rw', db.messages, db.bodies, async () => {
        await db.messages.bulkPut(split.map((s) => s.header))
        await db.bodies.bulkPut(split.map((s) => s.body))
      })
    )
  }

  /** Patch keywords / mailbox membership on cached headers (keeps bodies). */
  private async applyFlags(
    userId: string,
    updates: Array<Pick<Email, 'id'> & Partial<Pick<Email, 'mailboxIds' | 'keywords'>>>
  ): Promise<string[]> {
    const missing: string[] = []
    await this.safeWrite(() =>
      db.transaction('rw', db.messages, async () => {
        const rows = await db.messages.bulkGet(updates.map((u) => [userId, u.id] as [string, string]))
        const put: CachedEmail[] = []
        updates.forEach((u, i) => {
          const row = rows[i]
          if (!row) {
            missing.push(u.id)
            return
          }
          if (u.keywords) row.keywords = u.keywords
          if (u.mailboxIds) {
            row.mailboxIds = u.mailboxIds
            row._mailboxIds = activeIds(u.mailboxIds)
            row._mbSort = mailboxSortKeys(userId, row._mailboxIds, row.receivedAt)
          }
          put.push(row)
        })
        await db.messages.bulkPut(put)
      })
    )
    return missing
  }

  private async deleteRows(userId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const keys = ids.map((id) => [userId, id] as [string, string])
    await this.safeWrite(() =>
      db.transaction('rw', db.messages, db.bodies, async () => {
        await db.messages.bulkDelete(keys)
        await db.bodies.bulkDelete(keys)
      })
    )
  }

  private async replaceMailboxes(userId: string, mailboxes: Mailbox[]): Promise<void> {
    await this.safeWrite(() =>
      db.transaction('rw', db.folders, async () => {
        await db.folders.where('_userId').equals(userId).delete()
        await db.folders.bulkPut(mailboxes.map((mb) => ({ ...mb, _userId: userId })))
      })
    )
  }

  // --- optimistic edits (used by the email actions) ---------------------------

  /** Capture rows so a failed server call can restore them exactly. */
  async snapshot(ids: string[]): Promise<CacheSnapshot | null> {
    const userId = this.currentUserId
    if (!userId || ids.length === 0) return null
    const keys = ids.map((id) => [userId, id] as [string, string])
    return this.safeRead(async () => {
      const [headers, bodies] = await Promise.all([db.messages.bulkGet(keys), db.bodies.bulkGet(keys)])
      return {
        userId,
        ids,
        headers: headers.filter(Boolean) as CachedEmail[],
        bodies: bodies.filter(Boolean) as CachedBody[],
      }
    }, null)
  }

  async restore(snap: CacheSnapshot | null): Promise<void> {
    if (!snap) return
    const keys = snap.ids.map((id) => [snap.userId, id] as [string, string])
    await this.safeWrite(() =>
      db.transaction('rw', db.messages, db.bodies, async () => {
        await db.messages.bulkDelete(keys)
        await db.messages.bulkPut(snap.headers)
        await db.bodies.bulkPut(snap.bodies)
      })
    )
  }

  /** Remove emails from the local cache (delete). */
  async removeCachedEmails(ids: string[]): Promise<void> {
    if (this.currentUserId) await this.deleteRows(this.currentUserId, ids)
  }

  /** Patch keyword flags ($seen, $flagged, …) on cached emails. */
  async patchCachedKeywords(ids: string[], patch: Record<string, boolean | null>): Promise<void> {
    const userId = this.currentUserId
    if (!userId || ids.length === 0) return
    await this.safeWrite(() =>
      db.messages
        .where('[_userId+id]')
        .anyOf(ids.map((id) => [userId, id]))
        .modify((e) => {
          const next = { ...e.keywords }
          for (const [k, v] of Object.entries(patch)) {
            if (v) next[k] = true
            else delete next[k]
          }
          e.keywords = next
        })
    )
  }

  /** Move cached emails into a single mailbox (full replacement of membership). */
  async setCachedMailbox(ids: string[], mailboxId: string): Promise<void> {
    const userId = this.currentUserId
    if (!userId || ids.length === 0) return
    await this.applyFlags(
      userId,
      ids.map((id) => ({ id, mailboxIds: { [mailboxId]: true } }))
    )
  }

  // --- reads ------------------------------------------------------------------

  async getCachedEmails(userId: string, mailboxId: string, offset: number, limit: number) {
    return this.safeRead(
      () =>
        db.messages
          .where('_mbSort')
          .between(...mailboxSortRange(userId, mailboxId))
          .reverse()
          .offset(offset)
          .limit(limit)
          .toArray(),
      [] as CachedEmail[]
    )
  }

  async getCachedMailboxes(userId: string): Promise<Mailbox[]> {
    return this.safeRead(async () => {
      const rows = await db.folders.where('_userId').equals(userId).toArray()
      return rows.map(({ _userId, ...mb }) => mb)
    }, [] as Mailbox[])
  }

  /**
   * One email with its body: from the cache, else fetched (full properties)
   * and cached. Used by the reader for emails whose body isn't local yet.
   */
  async loadEmail(accountId: string, userId: string, id: string): Promise<Email | null> {
    const key: [string, string] = [userId, id]
    const [h, b] = await this.safeRead(
      () => Promise.all([db.messages.get(key), db.bodies.get(key)]),
      [undefined, undefined] as [CachedEmail | undefined, CachedBody | undefined]
    )
    if (h && b?.bodyValues) return { ...h, ...b } as Email
    const [fresh] = await jmapClient.getEmailsByIds(accountId, [id])
    if (!fresh) return null
    await this.storeEmails([fresh], userId)
    return fresh
  }

  /** Fetch one page from the server and write it through to the cache. */
  async fetchAndCacheEmails(
    accountId: string,
    userId: string,
    mailboxId: string,
    position: number,
    limit: number
  ): Promise<{ emails: Email[]; total: number; position: number }> {
    const result = await jmapClient.getEmails(accountId, { inMailbox: mailboxId }, undefined, position, limit)
    await this.storeEmails(result.emails, userId)
    return result
  }

  /** Fetch mailboxes from the server and persist them. */
  async fetchAndCacheMailboxes(accountId: string, userId: string) {
    const mailboxes = await jmapClient.getMailboxes(accountId)
    await this.replaceMailboxes(userId, mailboxes)
    return mailboxes
  }

  /**
   * Address book derived from mail already in the local cache: every unique
   * from/to/cc/replyTo address, ranked by frequency. Powers recipient
   * autocomplete. Headers only — cheap.
   */
  async getContacts(userId: string): Promise<Array<{ email: string; name?: string; n: number }>> {
    return this.safeRead(async () => {
      const map = new Map<string, { email: string; name?: string; n: number }>()
      await db.messages
        .where('_userId')
        .equals(userId)
        .each((e) => {
          for (const list of [e.from, e.to, e.cc, e.replyTo]) {
            for (const a of list || []) {
              const email = a?.email?.trim()
              if (!email || !email.includes('@')) continue
              const key = email.toLowerCase()
              const ex = map.get(key)
              if (ex) {
                ex.n++
                if (!ex.name && a.name) ex.name = a.name
              } else {
                map.set(key, { email, name: a.name || undefined, n: 1 })
              }
            }
          }
        })
      return Array.from(map.values()).sort((a, b) => b.n - a.n)
    }, [])
  }

  /** Full-text search over the local cache (subject, addresses, body). */
  async searchOffline(query: string, mailboxId?: string): Promise<Email[]> {
    const userId = this.currentUserId
    if (!userId) throw new Error('User not initialized')
    const q = query.toLowerCase().trim().substring(0, config.security.maxSearchQueryLength)
    if (q.length === 0) return []
    const terms = q.split(/\s+/).filter(Boolean)

    return this.safeRead(async () => {
      const scope = mailboxId
        ? new Set(
            (
              await db.messages
                .where('_mbSort')
                .between(...mailboxSortRange(userId, mailboxId))
                .primaryKeys()
            ).map((k) => (k as unknown as [string, string])[1])
          )
        : null
      const hits: [string, string][] = []
      await db.bodies
        .where('_userId')
        .equals(userId)
        .each((b) => {
          if (scope && !scope.has(b.id)) return
          const hay = b._searchText || ''
          if (terms.every((t) => hay.includes(t))) hits.push([userId, b.id])
        })
      const rows = (await db.messages.bulkGet(hits)).filter(Boolean) as CachedEmail[]
      rows.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0))
      return rows.slice(0, config.performance.searchResultLimit)
    }, [] as Email[])
  }

  // --- delta sync ---------------------------------------------------------------

  private stateKey(userId: string, type: 'Email' | 'Mailbox') {
    return `user:${userId}:state:${type}`
  }

  private async getState(userId: string, type: 'Email' | 'Mailbox'): Promise<string | null> {
    const row = await this.safeRead(() => db.syncStates.get(this.stateKey(userId, type)), undefined)
    return row?.state || null
  }

  private async setState(userId: string, type: 'Email' | 'Mailbox', state: string) {
    await this.safeWrite(() =>
      db.syncStates.put({ id: this.stateKey(userId, type), state, lastSync: Date.now(), position: 0, userId })
    )
  }

  /**
   * Begin syncing `accountId` into `userId`'s cache: an immediate delta sync,
   * desktop push, a poll fallback, and refresh on focus/online. Replaces any
   * previous account's loop.
   */
  start(accountId: string, userId: string) {
    this.stop()
    this.currentUserId = userId
    this.active = { accountId, userId }
    this.lastPushAt = 0
    void this.syncNow()

    void jmapClient
      .startPush((data) => {
        this.lastPushAt = Date.now()
        if (data === 'ping') return
        try {
          const change = JSON.parse(data)
          if (change?.changed?.[accountId]) void this.syncNow()
        } catch {
          void this.syncNow()
        }
      })
      .catch((e) => console.warn('[Sync] push unavailable:', e))

    const schedule = () => {
      const live = Date.now() - this.lastPushAt < PUSH_FRESH_MS
      this.pollTimer = window.setTimeout(() => {
        void this.syncNow()
        schedule()
      }, live ? POLL_WITH_PUSH_MS : POLL_MS)
    }
    schedule()

    const wake = () => void this.syncNow()
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake()
    }
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', onVisible)
    this.detach = () => {
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }

  stop() {
    if (this.pollTimer) window.clearTimeout(this.pollTimer)
    this.pollTimer = null
    this.detach?.()
    this.detach = null
    if (this.active) void jmapClient.stopPush()
    this.active = null
  }

  /**
   * Bring the cache up to date with the server. Coalesced: while a sync runs,
   * further calls queue exactly one follow-up run.
   */
  syncNow(): Promise<void> {
    if (this.running) {
      this.rerun = true
      return this.running
    }
    const target = this.active
    if (!target) return Promise.resolve()
    this.running = (async () => {
      try {
        do {
          this.rerun = false
          await this.syncOnce(target.accountId, target.userId)
        } while (this.rerun && this.active === target)
      } catch (e) {
        if (import.meta.env.DEV) console.error('[Sync] sync failed:', e)
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  private async syncOnce(accountId: string, userId: string) {
    if (this.cacheDisabled) return
    const state = await this.getState(userId, 'Email')
    if (!state || !(await this.syncChanges(accountId, userId, state))) {
      await this.reconcile(accountId, userId)
    }
  }

  /**
   * Apply server changes since `sinceState`. Returns false if the server can't
   * calculate them (state too old) — the caller then reconciles.
   */
  private async syncChanges(accountId: string, userId: string, sinceState: string): Promise<boolean> {
    let since = sinceState
    let first = true
    for (;;) {
      const calls: Array<[string, any, string]> = [
        ['Email/changes', { accountId, sinceState: since, maxChanges: MAX_CHANGES }, 'c'],
        [
          'Email/get',
          {
            accountId,
            '#ids': { resultOf: 'c', name: 'Email/changes', path: '/created' },
            properties: JMAPClient.EMAIL_PROPERTIES,
            fetchTextBodyValues: true,
            fetchHTMLBodyValues: true,
            maxBodyValueBytes: 256 * 1024,
          },
          'n',
        ],
        [
          'Email/get',
          {
            accountId,
            '#ids': { resultOf: 'c', name: 'Email/changes', path: '/updated' },
            properties: FLAG_PROPS,
          },
          'u',
        ],
      ]
      // Mailbox list rides along on the first round (counts change with mail).
      if (first) calls.push(['Mailbox/get', { accountId, ids: null }, 'm'])
      const res = await jmapClient.requestRaw(calls)
      const byId = Object.fromEntries(res.map(([name, args, id]) => [id, { name, args }]))

      const changes = byId.c
      if (!changes || changes.name === 'error') {
        if (changes?.args?.type === 'cannotCalculateChanges') return false
        throw new Error(changes?.args?.description || changes?.args?.type || 'Email/changes failed')
      }

      if (first && byId.m?.name === 'Mailbox/get') {
        const mbState = await this.getState(userId, 'Mailbox')
        if (byId.m.args.state !== mbState) {
          await this.replaceMailboxes(userId, byId.m.args.list || [])
          await this.setState(userId, 'Mailbox', byId.m.args.state)
        }
      }
      first = false

      const { created = [], updated = [], destroyed = [], newState, hasMoreChanges } = changes.args
      if (created.length || updated.length || destroyed.length) {
        await this.storeEmails(byId.n?.args?.list || [], userId)
        const missing = await this.applyFlags(userId, byId.u?.args?.list || [])
        await this.deleteRows(userId, destroyed)
        // Updated on the server but not cached locally → fetch in full.
        if (missing.length) await this.storeEmails(await jmapClient.getEmailsByIds(accountId, missing), userId)
      }
      await this.setState(userId, 'Email', newState)
      since = newState
      if (!hasMoreChanges) return true
    }
  }

  /**
   * Make the cache match the server without re-downloading what it already
   * has: ids + flags for every email (no bodies), prune / patch / fetch the
   * difference. Runs on first use and when the stored state is too old.
   */
  private async reconcile(accountId: string, userId: string) {
    const status = useSyncStatusStore.getState()
    status.setIndexing(true)
    try {
      // State FIRST: changes made while we list/download are replayed by the
      // next delta sync (applying them twice is harmless).
      const [[, emailGet], [, mbGet]] = await jmapClient.request([
        ['Email/get', { accountId, ids: [] }, 's'],
        ['Mailbox/get', { accountId, ids: null }, 'm'],
      ])
      await this.replaceMailboxes(userId, mbGet.list || [])
      await this.setState(userId, 'Mailbox', mbGet.state)

      // Every email id + flags, newest first.
      const server = new Map<string, Pick<Email, 'id' | 'mailboxIds' | 'keywords'>>()
      const order: string[] = []
      const page = jmapClient.maxObjectsInGet()
      for (let position = 0; ; position += page) {
        const [[, query], [, got]] = await jmapClient.request([
          [
            'Email/query',
            { accountId, sort: [{ property: 'receivedAt', isAscending: false }], position, limit: page },
            'q',
          ],
          [
            'Email/get',
            { accountId, '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' }, properties: FLAG_PROPS },
            'g',
          ],
        ])
        for (const e of got.list || []) server.set(e.id, e)
        order.push(...(query.ids || []))
        if ((query.ids || []).length < page) break
      }

      const local = await this.safeRead(
        () => db.messages.where('_userId').equals(userId).toArray(),
        [] as CachedEmail[]
      )
      const localIds = new Set(local.map((e) => e.id))
      await this.deleteRows(
        userId,
        local.filter((e) => !server.has(e.id)).map((e) => e.id)
      )
      await this.applyFlags(
        userId,
        local
          .filter((e) => {
            const s = server.get(e.id)
            return s && (!sameFlags(s.keywords, e.keywords) || !sameFlags(s.mailboxIds, e.mailboxIds))
          })
          .map((e) => server.get(e.id)!)
      )

      // Download what's missing, newest first, so the visible lists fill first.
      const missing = order.filter((id) => !localIds.has(id))
      for (let i = 0; i < missing.length; i += 50) {
        if (!this.active || this.active.userId !== userId) return // account switched
        await this.storeEmails(await jmapClient.getEmailsByIds(accountId, missing.slice(i, i + 50)), userId)
      }
      await this.setState(userId, 'Email', emailGet.state)
    } finally {
      status.setIndexing(false)
    }
  }
}

export const syncManager = new SyncManager()
