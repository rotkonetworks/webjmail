import Dexie, { Table } from 'dexie'
import { Email, Mailbox, Thread, JMAPSession } from '../api/types'
import { config } from '../config'

export interface CachedEmail extends Email {
  _syncedAt: number
  _mailboxIds: string[] // Denormalized for efficient queries
  _userId: string // Required for multi-user support - NEVER optional for security
}

interface SyncState {
  id: string // Format: "user:{userId}:mailbox:{mailboxId}" or "user:{userId}:global"
  state: string // JMAP state token
  lastSync: number
  position: number // For pagination
  userId: string // User isolation
}

interface AttachmentBlob {
  blobId: string
  data: Blob
  size: number
  type: string
  userId: string // User isolation
}

interface UserSession extends JMAPSession {
  id: string // Format: "user:{userId}"
  userId: string
  lastActivity: number
}

class MailDB extends Dexie {
  emails!: Table<CachedEmail>
  mailboxes!: Table<Mailbox & { _userId: string }>
  threads!: Table<Thread & { _userId: string }>
  syncStates!: Table<SyncState>
  attachments!: Table<AttachmentBlob>
  sessions!: Table<UserSession>

  constructor() {
    super('rotko-webmail')

    this.version(1).stores({
      // Primary key first, then compound indexes for multi-user support
      emails:
        'id, [_userId+threadId], [_userId+_mailboxIds+receivedAt], [_userId+_mailboxIds+keywords.$seen], [_userId+receivedAt], _syncedAt',
      mailboxes: 'id, [_userId+role], [_userId+parentId], _userId',
      threads: 'id, [_userId+id], _userId',
      syncStates: 'id, [userId+lastSync], userId',
      attachments: 'blobId, [userId+blobId], userId',
      sessions: 'id, userId, lastActivity',
    })
  }

  /**
   * Clear all data for a specific user (secure multi-user isolation)
   * Issue: Data leakage between users
   * Line: src/db/index.ts:52
   * Attack: Without proper user isolation, one user could access another's emails
   * Fix: Use userId-based filtering for all operations
   */
  async clearUserData(userId: string) {
    await this.transaction(
      'rw',
      this.emails,
      this.mailboxes,
      this.threads,
      this.syncStates,
      this.attachments,
      this.sessions,
      async () => {
        await Promise.all([
          this.emails.where('_userId').equals(userId).delete(),
          this.mailboxes.where('_userId').equals(userId).delete(),
          this.threads.where('_userId').equals(userId).delete(),
          this.syncStates.where('userId').equals(userId).delete(),
          this.attachments.where('userId').equals(userId).delete(),
          this.sessions.where('userId').equals(userId).delete(),
        ])
      }
    )
  }

  /**
   * Clear all data (for logout/reset scenarios)
   * Issue: Nuclear option for data cleanup
   * Line: src/db/index.ts:67
   * Attack: Should only be used for full app reset, not user switching
   * Fix: Use clearUserData for individual users
   */
  async clearAllData() {
    await this.transaction(
      'rw',
      this.emails,
      this.mailboxes,
      this.threads,
      this.syncStates,
      this.attachments,
      this.sessions,
      async () => {
        await Promise.all([
          this.emails.clear(),
          this.mailboxes.clear(),
          this.threads.clear(),
          this.syncStates.clear(),
          this.attachments.clear(),
          this.sessions.clear(),
        ])
      }
    )
  }

  /**
   * Get current user from session store
   * Issue: Session management security
   * Line: src/db/index.ts:83
   * Attack: Must validate user sessions properly
   * Fix: Check lastActivity and validate session
   */
  async getCurrentUser(): Promise<string | null> {
    const session = await this.sessions.orderBy('lastActivity').reverse().first()

    if (!session) return null

    // Session expires after configured timeout for security
    const SESSION_TIMEOUT = config.security.sessionTimeoutMs
    if (Date.now() - session.lastActivity > SESSION_TIMEOUT) {
      await this.sessions.delete(session.id)
      return null
    }

    return session.userId
  }

  /**
   * Update user session activity
   * Issue: Session timing attacks
   * Line: src/db/index.ts:103
   * Attack: Prevent timing attacks on session validation
   * Fix: Update timestamp regularly but not on every operation
   */
  async updateUserActivity(userId: string) {
    const sessionId = `user:${userId}`
    await this.sessions.put({
      id: sessionId,
      userId,
      lastActivity: Date.now(),
      // Session data would include JMAPSession fields
    } as UserSession)
  }
}

export const db = new MailDB()
