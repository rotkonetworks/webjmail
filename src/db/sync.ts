// src/db/sync.ts
import Dexie from 'dexie'
import { db, type CachedEmail } from './index'
import { jmapClient } from '../api/jmap'
import { Email } from '../api/types'
import { config } from '../config'

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
      // Get all mailboxes first
      const mailboxes = await jmapClient.getMailboxes(accountId)
      
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
          
          // Cache emails with user isolation
          await this.cacheEmails(emails)
          
          position += emails.length
          total = newTotal
          
          // Throttle to avoid overwhelming server
          await this.delay(500)
          
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
   * Delta sync using JMAP Email/changes for efficiency
   * Bug 7: Add background sync/delta updates
   */
  async syncUpdates(accountId: string): Promise<void> {
    if (!this.currentUserId) return

    const syncState = await db.syncStates.get(`user:${this.currentUserId}:global`)
    if (!syncState?.state) {
      // No previous state, perform full sync
      return this.fullInitialSync(accountId)
    }

    try {
      const responses = await jmapClient.request([
        [
          'Email/changes',
          {
            accountId,
            sinceState: syncState.state,
            maxChanges: 500,
          },
          '0',
        ],
      ])

      const changes = responses[0][1]
      
      // Fetch created/updated emails
      if (changes.created.length > 0 || changes.updated.length > 0) {
        const emailIds = [...changes.created, ...changes.updated]
        const { emails } = await jmapClient.getEmails(accountId, { ids: emailIds })
        await this.cacheEmails(emails)
      }

      // Delete destroyed emails
      if (changes.destroyed.length > 0) {
        await db.emails.bulkDelete(changes.destroyed)
      }

      // Update sync state
      await db.syncStates.put({
        ...syncState,
        state: changes.newState,
        lastSync: Date.now(),
      })

      if (import.meta.env.DEV) {
        console.log(`[Sync] Delta sync: ${changes.created.length} created, ${changes.updated.length} updated, ${changes.destroyed.length} destroyed`)
      }
    } catch (error) {
      console.error('[Sync] Delta sync failed:', error)
    }
  }

  /**
   * Helper to cache emails with proper user isolation
   */
  private async cacheEmails(emails: Email[]): Promise<void> {
    if (!this.currentUserId) return

    const cachedEmails: CachedEmail[] = emails.map((email) => ({
      ...email,
      _syncedAt: Date.now(),
      _mailboxIds: Object.keys(email.mailboxIds).filter((id) => email.mailboxIds[id]),
      _userId: this.currentUserId!,
      preview: email.preview?.replace(/<[^>]*>/g, '').substring(0, config.security.maxPreviewLength) || '',
      subject: email.subject?.replace(/<[^>]*>/g, '').substring(0, config.security.maxSubjectLength) || '',
    }))

    await db.emails.bulkPut(cachedEmails)
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
    const q = query.toLowerCase().trim().substring(0, config.security.maxSearchQueryLength)
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
      .limit(config.performance.searchResultLimit)
      .toArray()

    return results
  }

 startPushSync(accountId: string) {
   if (this.eventSource) return
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
   if (emailIds.length > config.performance.attachmentPrefetchLimit) {
     emailIds = emailIds.slice(0, config.performance.attachmentPrefetchLimit) // Limit batch size
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
