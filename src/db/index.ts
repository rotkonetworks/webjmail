import Dexie, { Table } from 'dexie'
import { Email, Mailbox, Thread, JMAPSession } from '../api/types'
import { config } from '../config'

export interface CachedEmail extends Email {
  _syncedAt: number
  _mailboxIds: string[]
  _userId: string
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
  emails!: Table<CachedEmail>
  mailboxes!: Table<Mailbox & { _userId: string }>
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
  }

  async clearUserData(userId: string) {
    await this.transaction(
      'rw',
      [this.emails, this.mailboxes, this.threads, this.syncStates, this.attachments, this.sessions],
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

  async clearAllData() {
    await this.transaction(
      'rw',
      [this.emails, this.mailboxes, this.threads, this.syncStates, this.attachments, this.sessions],
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
