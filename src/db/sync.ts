// src/db/sync.ts
import { db, type CachedEmail } from './index'
import { jmapClient } from '../api/jmap'
import { Email } from '../api/types'
import { config } from '../config'
import { isTauri } from '../lib/tauri'
import { useSyncStatusStore } from '../stores/syncStatusStore'

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

export class SyncManager {
  private syncInterval: number | null = null
  private eventSource: EventSource | null = null
  private currentUserId: string | null = null
  // Guards so the background full index runs at most once per session.
  private fullIndexRunning = false

  async initializeUser(userId: string) {
    // Validate user ID to prevent injection attacks
    if (!userId || typeof userId !== 'string' || userId.length === 0) {
      throw new Error('Invalid user ID')
    }

    // Sanitize user ID - only allow safe characters
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9._@-]/g, '')
    if (sanitizedUserId !== userId) {
      throw new Error('User ID contains invalid characters')
    }

    // Limit user ID length to prevent DoS
    if (userId.length > config.security.maxUserIdLength) {
      throw new Error('User ID too long')
    }

    this.currentUserId = userId
    await db.updateUserActivity(userId)
  }

  async initialSync(accountId: string, mailboxId: string) {
    if (!this.currentUserId) {
      throw new Error('User not initialized')
    }

    const syncStateId = `user:${this.currentUserId}:mailbox:${mailboxId}`
    const existingState = await db.syncStates.get(syncStateId)

    // Check if we have cached data
    const cachedCount = await this.countCachedEmails(this.currentUserId, mailboxId)

    if (cachedCount > 0 && existingState) {
      // Return cached data immediately
      return {
        fromCache: true,
        emails: await this.getMailboxEmails(mailboxId, 0, 50),
      }
    }

    // Perform fresh sync
    return this.syncMailbox(accountId, mailboxId)
  }

  async syncMailbox(accountId: string, mailboxId: string, position = 0) {
    if (!this.currentUserId) {
      throw new Error('User not initialized')
    }

    const syncStateId = `user:${this.currentUserId}:mailbox:${mailboxId}`
    const syncState = await db.syncStates.get(syncStateId)

    if (syncState) return syncState
    const {
      emails,
      total,
      position: newPosition,
    } = await jmapClient.getEmails(accountId, { inMailbox: mailboxId }, undefined, position, config.performance.emailBatchSize)

    // Validate and transform emails before storage
    const cachedEmails: CachedEmail[] = emails.map((email) => {
      // Validate required fields
      if (!email.id || !email.threadId || !email.receivedAt) {
        throw new Error(`Invalid email data: missing required fields`)
      }

      // CRITICAL: Ensure user ID is always set for security isolation
      if (!this.currentUserId) {
        throw new Error('Cannot sync emails without valid user context')
      }

      // Sanitize email content to prevent XSS
      const sanitizedPreview = email.preview?.replace(/<[^>]*>/g, '').substring(0, config.security.maxPreviewLength) || ''
      const sanitizedSubject = email.subject?.replace(/<[^>]*>/g, '').substring(0, config.security.maxSubjectLength) || ''

      return {
        ...email,
        _syncedAt: Date.now(),
        _mailboxIds: Object.keys(email.mailboxIds).filter((id) => email.mailboxIds[id]),
        _userId: this.currentUserId, // REQUIRED field for security
        _searchText: buildSearchText(email),
        preview: sanitizedPreview,
        subject: sanitizedSubject,
      }
    })

    await db.transaction('rw', db.emails, db.syncStates, async () => {
      await db.emails.bulkPut(cachedEmails)
      await db.syncStates.put({
        id: syncStateId,
        state: '', // Would come from JMAP response
        lastSync: Date.now(),
        position: newPosition,
        userId: this.currentUserId!,
      })
    })

    return { emails: cachedEmails, total, fromCache: false }
  }

  /**
   * Full initial sync for all emails in account (background process)
   * Bug 6: Implement consistent offline caching with full sync
   */
  async fullInitialSync(accountId: string): Promise<void> {
    if (!this.currentUserId) {
      throw new Error('User not initialized')
    }

    try {
      // Get all mailboxes first and persist them so the sidebar is instant too.
      const mailboxes = await jmapClient.getMailboxes(accountId)
      await db.transaction('rw', db.mailboxes, async () => {
        await db.mailboxes.where('_userId').equals(this.currentUserId!).delete()
        await db.mailboxes.bulkPut(mailboxes.map((mb) => ({ ...mb, _userId: this.currentUserId! })))
      })

      for (const mailbox of mailboxes) {
        let position = 0
        let total = Infinity
        
        if (import.meta.env.DEV) {
          console.log(`[Sync] Starting full sync for mailbox: ${mailbox.name}`)
        }
        
        while (position < total) {
          const { emails, total: newTotal } = await jmapClient.getEmails(
            accountId, 
            { inMailbox: mailbox.id }, 
            undefined, 
            position, 
            config.performance.emailBatchSize
          )
          
          // Reached the end (or empty page) — stop to avoid an infinite loop.
          if (emails.length === 0) break

          // Cache emails with user isolation
          await this.cacheEmails(emails)

          position += emails.length
          total = newTotal

          // Throttle to avoid overwhelming server
          await this.delay(config.security.rateLimitDelayMs)
          
          if (import.meta.env.DEV) {
            console.log(`[Sync] Synced ${position}/${total} emails in ${mailbox.name}`)
          }
        }
      }
      
      // Update global sync state
      await db.syncStates.put({
        id: `user:${this.currentUserId}:global`,
        state: '', // Would be updated with latest JMAP state
        lastSync: Date.now(),
        position: 0,
        userId: this.currentUserId,
      })
      
      if (import.meta.env.DEV) {
        console.log('[Sync] Full initial sync completed')
      }
    } catch (error) {
      console.error('[Sync] Full initial sync failed:', error)
      throw error
    }
  }

  /**
   * Kick off a one-time, resumable background pass that pulls every email in
   * the account into the local index (subject + addresses + body) so search
   * works fully offline — in the browser and in the desktop build alike.
   * Safe to call repeatedly: it no-ops while running or if a complete pass ran
   * within the last day.
   */
  async ensureFullIndex(accountId: string): Promise<void> {
    if (!this.currentUserId) return
    if (this.fullIndexRunning) return

    const markerId = `user:${this.currentUserId}:fullIndex`
    const marker = await db.syncStates.get(markerId)
    const FRESH_MS = 24 * 60 * 60 * 1000
    if (marker?.state === 'complete' && Date.now() - marker.lastSync < FRESH_MS) {
      return
    }

    this.fullIndexRunning = true
    useSyncStatusStore.getState().setIndexing(true)
    try {
      if (import.meta.env.DEV) console.log('[Sync] Building full local index…')
      await this.fullInitialSync(accountId)
      await db.syncStates.put({
        id: markerId,
        state: 'complete',
        lastSync: Date.now(),
        position: 0,
        userId: this.currentUserId,
      })
      if (import.meta.env.DEV) console.log('[Sync] Full local index complete')
    } catch (error) {
      console.error('[Sync] Full index pass failed:', error)
    } finally {
      this.fullIndexRunning = false
      useSyncStatusStore.getState().setIndexing(false)
    }
  }

  /**
   * Normalize a server Email into the shape we persist locally (user isolation,
   * search haystack, sanitized preview/subject). Single source of truth used by
   * every write path so the cache is consistent.
   */
  private toCached(email: Email, userId: string): CachedEmail {
    return {
      ...email,
      _syncedAt: Date.now(),
      _mailboxIds: Object.keys(email.mailboxIds).filter((id) => email.mailboxIds[id]),
      _userId: userId,
      _searchText: buildSearchText(email),
      preview: email.preview?.replace(/<[^>]*>/g, '').substring(0, config.security.maxPreviewLength) || '',
      subject: email.subject?.replace(/<[^>]*>/g, '').substring(0, config.security.maxSubjectLength) || '',
    }
  }

  /**
   * Helper to cache emails with proper user isolation
   */
  private async cacheEmails(emails: Email[]): Promise<void> {
    if (!this.currentUserId) return
    await db.emails.bulkPut(emails.map((e) => this.toCached(e, this.currentUserId!)))
  }

  /**
   * Make sure the manager is bound to the given user before a cache read/write.
   * Cheap no-op when already initialized for that user.
   */
  async ensureUser(userId: string): Promise<void> {
    if (this.currentUserId !== userId) {
      await this.initializeUser(userId)
    }
  }

  /**
   * All cached emails for a mailbox, newest first. Uses the multiEntry
   * `*_mailboxIds` index (a scalar `equals` against an array field), then sorts
   * by receivedAt in JS — receivedAt is an ISO-8601 string so lexical compare is
   * chronological. The volumes here (a few thousand rows) make this trivial.
   */
  private async mailboxEmailsSorted(userId: string, mailboxId: string): Promise<CachedEmail[]> {
    const rows = await db.emails
      .where('_mailboxIds')
      .equals(mailboxId)
      .filter((e) => e._userId === userId)
      .toArray()
    rows.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0))
    return rows
  }

  /**
   * Read one page of cached emails for a mailbox, newest first. This is what the
   * UI renders instantly on launch (no server round-trip).
   */
  async getCachedEmails(userId: string, mailboxId: string, offset: number, limit: number) {
    const sorted = await this.mailboxEmailsSorted(userId, mailboxId)
    return sorted.slice(offset, offset + limit)
  }

  /** Total emails cached locally for a mailbox. */
  async countCachedEmails(userId: string, mailboxId: string): Promise<number> {
    return db.emails
      .where('_mailboxIds')
      .equals(mailboxId)
      .filter((e) => e._userId === userId)
      .count()
  }

  /**
   * Fetch one page from the server and write it through to the local cache.
   * Returns the freshly cached page plus the server's total so the list can
   * paginate. This keeps the cache warm from normal browsing, not just the
   * once-a-day full index.
   */
  async fetchAndCacheEmails(
    accountId: string,
    userId: string,
    mailboxId: string,
    position: number,
    limit: number
  ): Promise<{ emails: CachedEmail[]; total: number; position: number }> {
    await this.ensureUser(userId)
    const { emails, total } = await jmapClient.getEmails(
      accountId,
      { inMailbox: mailboxId },
      undefined,
      position,
      limit
    )
    const cached = emails.map((e) => this.toCached(e, userId))
    await db.emails.bulkPut(cached)
    return { emails: cached, total, position }
  }

  /**
   * Remove emails from the local cache (after a server destroy). The cache-first
   * list renders from IndexedDB, so deletes must prune it here or the rows
   * reappear on the next read.
   */
  async removeCachedEmails(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await db.emails.bulkDelete(ids)
  }

  /**
   * Patch keyword flags ($seen, $flagged, …) on cached emails so the list
   * reflects read/flag changes immediately (it reads keywords from the cache).
   */
  async patchCachedKeywords(ids: string[], patch: Record<string, boolean>): Promise<void> {
    if (ids.length === 0) return
    await db.transaction('rw', db.emails, async () => {
      for (const id of ids) {
        const e = await db.emails.get(id)
        if (e) {
          e.keywords = { ...e.keywords, ...patch }
          await db.emails.put(e)
        }
      }
    })
  }

  /**
   * Move cached emails into a single mailbox (full replacement of membership),
   * so the cache-first list drops them from the source folder immediately and
   * shows them under the target. Mirrors a JMAP `mailboxIds` set.
   */
  async setCachedMailbox(ids: string[], mailboxId: string): Promise<void> {
    if (ids.length === 0) return
    await db.transaction('rw', db.emails, async () => {
      for (const id of ids) {
        const e = await db.emails.get(id)
        if (e) {
          e.mailboxIds = { [mailboxId]: true }
          e._mailboxIds = [mailboxId]
          await db.emails.put(e)
        }
      }
    })
  }

  /** Mailboxes cached locally for this user (instant sidebar on launch). */
  async getCachedMailboxes(userId: string) {
    const rows = await db.mailboxes.where('_userId').equals(userId).toArray()
    // Drop the storage-only field so callers get plain Mailbox objects.
    return rows.map(({ _userId, ...mb }) => mb)
  }

  /** Fetch mailboxes from the server and persist them for offline/instant use. */
  async fetchAndCacheMailboxes(accountId: string, userId: string) {
    await this.ensureUser(userId)
    const mailboxes = await jmapClient.getMailboxes(accountId)
    await db.transaction('rw', db.mailboxes, async () => {
      await db.mailboxes.where('_userId').equals(userId).delete()
      await db.mailboxes.bulkPut(mailboxes.map((mb) => ({ ...mb, _userId: userId })))
    })
    return mailboxes
  }

  /**
   * Throttling helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async getMailboxEmails(mailboxId: string, offset: number, limit: number) {
    if (!this.currentUserId) {
      throw new Error('User not initialized')
    }
    return this.getCachedEmails(this.currentUserId, mailboxId, offset, limit)
  }

  async searchOffline(query: string, mailboxId?: string): Promise<Email[]> {
    if (!this.currentUserId) {
      throw new Error('User not initialized')
    }

    // Sanitize search query
    const q = query.toLowerCase().trim().substring(0, config.security.maxSearchQueryLength)
    if (q.length === 0) return []

    // Candidate set: a single mailbox (multiEntry index) or every cached email
    // for the user. Sorting/scoping happens in JS over a few thousand rows.
    const candidates = mailboxId
      ? await this.mailboxEmailsSorted(this.currentUserId, mailboxId)
      : await db.emails.where('_userId').equals(this.currentUserId).toArray()

    // Support multi-word queries: every whitespace-separated term must appear
    // somewhere in the haystack (AND semantics, like a basic server search).
    const terms = q.split(/\s+/).filter(Boolean)

    const results: Email[] = []
    for (const email of candidates) {
      const haystack =
        email._searchText ||
        // Fallback for rows cached before the index field existed.
        `${email.subject || ''} ${email.from?.[0]?.email || ''} ${
          email.from?.[0]?.name || ''
        } ${email.preview || ''}`.toLowerCase()
      if (terms.every((t) => haystack.includes(t))) {
        results.push(email)
        if (results.length >= config.performance.searchResultLimit) break
      }
    }

    return results
  }

 startPushSync(accountId: string) {
   if (this.eventSource) return
   // The desktop build can't use EventSource (no CORS-safe channel); it relies
   // on react-query's polling interval instead.
   if (isTauri) {
     console.log('[Sync] Push sync disabled in desktop build; using polling')
     return
   }
   if (!this.currentUserId) {
     throw new Error('User not initialized')
   }

   let reconnectAttempts = 0
   const maxReconnectAttempts = config.performance.maxReconnectAttempts
   const reconnectDelay = config.performance.reconnectDelayMs

   const connect = () => {
     try {
       this.eventSource = jmapClient.createEventSource(['Email', 'Mailbox'])

       this.eventSource.addEventListener('open', () => {
         console.log('[Sync] Push connection established')
         reconnectAttempts = 0 // Reset attempts on successful connection
       })

       this.eventSource.addEventListener('state', async (event) => {
         try {
           const data = JSON.parse(event.data)
           if (data.changed?.[accountId]?.Email) {
             console.log('[Sync] Email state changed:', data.changed[accountId].Email)
             await this.handleEmailChanges(accountId, data.changed[accountId].Email)
           }
           if (data.changed?.[accountId]?.Mailbox) {
             console.log('[Sync] Mailbox state changed')
             // Trigger mailbox refresh
             window.dispatchEvent(new CustomEvent('mailbox-changed'))
           }
         } catch (error) {
           console.error('[Sync] Failed to process push event:', error)
           // Don't let one bad event kill the entire sync
         }
       })

       this.eventSource.addEventListener('error', (event) => {
         console.error('[Sync] EventSource error:', event)
         this.eventSource?.close()
         this.eventSource = null

         // Attempt reconnection with exponential backoff
         if (reconnectAttempts < maxReconnectAttempts) {
           reconnectAttempts++
           const delay = reconnectDelay * Math.pow(2, reconnectAttempts - 1)
           console.log(`[Sync] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`)
           setTimeout(() => connect(), delay)
         } else {
           console.error('[Sync] Max reconnection attempts reached')
         }
       })
     } catch (error) {
       console.error('[Sync] Failed to create EventSource:', error)
     }
   }

   connect()
 }

 private async handleEmailChanges(accountId: string, _newState: string) {
   // A push 'state' change arrived for Email. The visible lists are served by
   // react-query (from the server), so the effective refresh is to invalidate
   // them — broadcast an event the app listens for (see useLocalIndex).
   if (typeof window !== 'undefined') {
     window.dispatchEvent(
       new CustomEvent('jmap-changed', { detail: { accountId, type: 'Email' } })
     )
   }
 }

 stop() {
   this.eventSource?.close()
   this.eventSource = null
   this.currentUserId = null
   if (this.syncInterval) {
     clearInterval(this.syncInterval)
     this.syncInterval = null
   }
 }

 getCurrentUserId(): string | null {
   return this.currentUserId
 }
}

export const syncManager = new SyncManager()
