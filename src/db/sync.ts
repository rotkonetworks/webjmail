// src/db/sync.ts
import Dexie from 'dexie'
import { db, type CachedEmail } from './index'
import { jmapClient } from '../api/jmap'
import { Email } from '../api/types'

export class SyncManager {
  private syncInterval: number | null = null
  private eventSource: EventSource | null = null
  private currentUserId: string | null = null

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
    if (userId.length > 255) {
      throw new Error('User ID too long')
    }

    // Limit user ID length to prevent DoS
    if (userId.length > 255) {
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
    const cachedCount = await db.emails
      .where('[_userId+_mailboxIds+receivedAt]')
      .between(
        [this.currentUserId, mailboxId, Dexie.minKey],
        [this.currentUserId, mailboxId, Dexie.maxKey]
      )
      .count()

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

    const {
      emails,
      total,
      position: newPosition,
    } = await jmapClient.getEmails(accountId, { inMailbox: mailboxId }, undefined, position, 50)

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
      const sanitizedPreview = email.preview?.replace(/<[^>]*>/g, '').substring(0, 500) || ''
      const sanitizedSubject = email.subject?.replace(/<[^>]*>/g, '').substring(0, 1000) || ''

      return {
        ...email,
        _syncedAt: Date.now(),
        _mailboxIds: Object.keys(email.mailboxIds).filter((id) => email.mailboxIds[id]),
        _userId: this.currentUserId, // REQUIRED field for security
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

  async getMailboxEmails(mailboxId: string, offset: number, limit: number) {
    if (!this.currentUserId) {
      throw new Error('User not initialized')
    }

    return db.emails
      .where('[_userId+_mailboxIds+receivedAt]')
      .between(
        [this.currentUserId, mailboxId, Dexie.minKey],
        [this.currentUserId, mailboxId, Dexie.maxKey]
      )
      .reverse() // Most recent first
      .offset(offset)
      .limit(limit)
      .toArray()
  }

  async searchOffline(query: string, mailboxId?: string): Promise<Email[]> {
    if (!this.currentUserId) {
      throw new Error('User not initialized')
    }

    // Sanitize search query
    const q = query.toLowerCase().trim().substring(0, 100)
    if (q.length === 0) return []

    let collection = mailboxId
      ? db.emails
          .where('[_userId+_mailboxIds+receivedAt]')
          .between(
            [this.currentUserId, mailboxId, Dexie.minKey],
            [this.currentUserId, mailboxId, Dexie.maxKey]
          )
      : db.emails.where('_userId').equals(this.currentUserId)

    const results = await collection
      .filter(
        (email) =>
          email.subject?.toLowerCase().includes(q) ||
          email.from?.[0]?.email?.toLowerCase().includes(q) ||
          email.from?.[0]?.name?.toLowerCase().includes(q) ||
          email.preview?.toLowerCase().includes(q)
      )
      .limit(30)
      .toArray()

    return results
  }

 startPushSync(accountId: string) {
   if (this.eventSource) return
   if (!this.currentUserId) {
     throw new Error('User not initialized')
   }

   let reconnectAttempts = 0
   const maxReconnectAttempts = 5
   const reconnectDelay = 5000

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

 private async handleEmailChanges(accountId: string, newState: string) {
   if (!this.currentUserId) return

   // Get changes since last state
   const syncState = await db.syncStates.get(`user:${this.currentUserId}:global`)
   if (!syncState) return

   try {
     const changes = await jmapClient.request([
       [
         'Email/changes',
         {
           accountId,
           sinceState: syncState.state,
           maxChanges: 500, // Limit to prevent overwhelming
         },
         '0',
       ],
     ])

     // Process changes in batches to avoid blocking
     // Implementation would handle created, updated, destroyed arrays
   } catch (error) {
     console.error('[Sync] Failed to handle email changes:', error)
   }
 }

 async prefetchBodies(emailIds: string[]) {
   if (!this.currentUserId) return
   if (emailIds.length > 10) {
     emailIds = emailIds.slice(0, 10) // Limit batch size
   }

   // Batch fetch email bodies that aren't cached
   const emails = await db.emails
     .where('_userId')
     .equals(this.currentUserId)
     .and((email) => emailIds.includes(email.id))
     .toArray()

   const needsBodies = emails.filter((e) => !e.bodyValues)

   if (needsBodies.length === 0) return

   // Fetch from server in smaller batches
   // Implementation would fetch and update cached emails
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
