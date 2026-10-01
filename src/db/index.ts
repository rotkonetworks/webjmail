import Dexie, { Table } from 'dexie'
import { Email, Mailbox, Thread, JMAPSession } from '../api/types'
import { config } from '../config'

/**
 * A cached email HEADER row — what lists render. Bodies (`BODY_FIELDS`) live in
 * the separate `bodies` table, so these rows stay small: a list page, a live
 * query re-run or the sync diff never deserializes message bodies. The body
 * fields are therefore absent on rows read from `db.messages`.
 *
 * Primary key is `[_userId+id]`: JMAP ids are only unique per account (Stalwart
 * hands out short per-account ids), so keying by `id` alone let one account's
 * rows overwrite another's.
 */
export interface CachedEmail extends Email {
  _syncedAt: number
  _mailboxIds: string[]
  _userId: string
  // One `${_userId}|${mailboxId}|${receivedAt}` key per mailbox the email is in.
  // multiEntry-indexed so a mailbox page is an ordered index range (reverse +
  // limit) that only reads the rows on that page. See `mailboxSortKeys`.
  _mbSort: string[]
}

/** Body of a cached email (same `[_userId+id]` key as its header row). */
export interface CachedBody {
  id: string
  _userId: string
  bodyStructure?: Email['bodyStructure']
  bodyValues?: Email['bodyValues']
  textBody?: Email['textBody']
  htmlBody?: Email['htmlBody']
  // Lowercased, HTML-stripped haystack (subject + addresses + body) used for
  // offline full-text search. Not a Dexie index — matched via substring filter.
  _searchText?: string
}

export type CachedMailbox = Mailbox & { _userId: string }

export const BODY_FIELDS = ['bodyStructure', 'bodyValues', 'textBody', 'htmlBody', '_searchText'] as const

/** Split a full cached email into its header row and body row. */
export function splitEmail(e: CachedEmail & Partial<CachedBody>): { header: CachedEmail; body: CachedBody } {
  const header: any = { ...e }
  const body: any = { id: e.id, _userId: e._userId }
  for (const f of BODY_FIELDS) {
    if (f in header) {
      if (header[f] !== undefined) body[f] = header[f]
      delete header[f]
    }
  }
  return { header, body }
}

/** Sortable per-mailbox index keys for a cached email (receivedAt is ISO-8601). */
export function mailboxSortKeys(userId: string, mailboxIds: string[], receivedAt: string): string[] {
  return mailboxIds.map((mb) => `${userId}|${mb}|${receivedAt || ''}`)
}

/** Index range covering every email of one mailbox for one user. */
export function mailboxSortRange(userId: string, mailboxId: string): [string, string] {
  const prefix = `${userId}|${mailboxId}|`
  return [prefix, prefix + '￿']
}

interface SyncState {
  id: string
  state: string
  lastSync: number
  position: number
  userId: string
}

interface AttachmentBlob {
  blobId: string
  data: Blob
  size: number
  type: string
  userId: string
}

interface UserSession extends JMAPSession {
  id: string
  userId: string
  lastActivity: number
}

class MailDB extends Dexie {
  messages!: Table<CachedEmail, [string, string]>
  bodies!: Table<CachedBody, [string, string]>
  folders!: Table<CachedMailbox, [string, string]>
  threads!: Table<Thread & { _userId: string }>
  syncStates!: Table<SyncState>
  attachments!: Table<AttachmentBlob>
  sessions!: Table<UserSession>

  constructor() {
    super('rotko-webmail')

    this.version(1).stores({
      emails:
        'id, [_userId+threadId], [_userId+_mailboxIds+receivedAt], [_userId+_mailboxIds+keywords.$seen], [_userId+receivedAt], _syncedAt',
      mailboxes: 'id, [_userId+role], [_userId+parentId], _userId',
      threads: 'id, [_userId+id], _userId',
      syncStates: 'id, [userId+lastSync], userId',
      attachments: 'blobId, [userId+blobId], userId',
      sessions: 'id, userId, lastActivity',
    })

    // v2: `_mailboxIds` is an ARRAY, so a compound index over it can never match
    // a scalar mailbox id — use a multiEntry index instead.
    this.version(2).stores({
      emails:
        'id, [_userId+threadId], *_mailboxIds, [_userId+receivedAt], _userId, _syncedAt',
    })

    // v3: `*_mbSort` for ordered, paged mailbox reads.
    this.version(3)
      .stores({
        emails:
          'id, [_userId+threadId], *_mailboxIds, *_mbSort, [_userId+receivedAt], _userId, _syncedAt',
      })
      .upgrade((tx) =>
        tx
          .table('emails')
          .toCollection()
          .modify((e: CachedEmail) => {
            e._mbSort = mailboxSortKeys(e._userId, e._mailboxIds || [], e.receivedAt)
          })
      )

    // v4: new tables keyed `[_userId+id]` (a primary key can't change in place),
    // with bodies split out of the header rows. Old rows are copied over; the
    // delta sync's first reconcile then prunes anything stale or mis-owned.
    this.version(4)
      .stores({
        messages: '[_userId+id], [_userId+threadId], *_mbSort, _userId',
        bodies: '[_userId+id], _userId',
        folders: '[_userId+id], _userId',
      })
      .upgrade(async (tx) => {
        // Batched by primary key so the old ~200MB store is never all in memory.
        const emails = tx.table('emails')
        let after = ''
        for (;;) {
          const batch = await emails.where(':id').above(after).limit(200).toArray()
          if (batch.length === 0) break
          const split = batch
            .filter((e) => e._userId)
            .map((e) =>
              splitEmail({
                ...e,
                _mbSort: e._mbSort ?? mailboxSortKeys(e._userId, e._mailboxIds || [], e.receivedAt),
              })
            )
          await tx.table('bodies').bulkPut(split.map((x) => x.body))
          await tx.table('messages').bulkPut(split.map((x) => x.header))
          after = batch[batch.length - 1].id
        }
        const mbs = await tx.table('mailboxes').toArray()
        await tx.table('folders').bulkPut(mbs.filter((m) => m._userId))
      })

    // v5: drop the id-keyed tables migrated in v4.
    this.version(5).stores({ emails: null, mailboxes: null })
  }

  async clearUserData(userId: string) {
    await this.transaction(
      'rw',
      [this.messages, this.bodies, this.folders, this.threads, this.syncStates, this.attachments, this.sessions],
      async () => {
        await Promise.all([
          this.messages.where('_userId').equals(userId).delete(),
          this.bodies.where('_userId').equals(userId).delete(),
          this.folders.where('_userId').equals(userId).delete(),
          this.threads.where('_userId').equals(userId).delete(),
          this.syncStates.where('userId').equals(userId).delete(),
          this.attachments.where('userId').equals(userId).delete(),
          this.sessions.where('userId').equals(userId).delete(),
        ])
      }
    )
  }

  async clearAllData() {
    await this.transaction(
      'rw',
      [this.messages, this.bodies, this.folders, this.threads, this.syncStates, this.attachments, this.sessions],
      async () => {
        await Promise.all([
          this.messages.clear(),
          this.bodies.clear(),
          this.folders.clear(),
          this.threads.clear(),
          this.syncStates.clear(),
          this.attachments.clear(),
          this.sessions.clear(),
        ])
      }
    )
  }

  async getCurrentUser(): Promise<string | null> {
    const session = await this.sessions.orderBy('lastActivity').reverse().first()
    if (!session) return null

    const SESSION_TIMEOUT = config.security.sessionTimeoutMs
    if (Date.now() - session.lastActivity > SESSION_TIMEOUT) {
      await this.sessions.delete(session.id)
      return null
    }

    return session.userId
  }

  async updateUserActivity(userId: string) {
    const sessionId = `user:${userId}`
    await this.sessions.put({
      id: sessionId,
      userId,
      lastActivity: Date.now(),
    } as UserSession)
  }
}

export const db = new MailDB()
