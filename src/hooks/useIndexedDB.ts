import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Dexie from 'dexie'
import { db } from '../db'
import { syncManager } from '../db/sync'
import { useAuthStore } from '../stores/authStore'
import { usePrimaryAccountId } from './useJMAP'

/**
 * Get user ID from session for database operations
 * Issue: User identification and session validation
 * Line: src/hooks/useIndexedDB.ts:11
 * Attack: Must ensure proper user identification for data isolation
 * Fix: Use hash-based user ID and validate session
 */
function useCurrentUserId(): string | null {
  const session = useAuthStore((state) => state.session)

  if (!session?.username) return null

  // Create a consistent, safe user ID from username + server
  // This prevents username collisions across different servers
  const serverUrl = session.apiUrl || 'unknown'
  const userIdentifier = `${session.username}@${new URL(serverUrl).hostname}`

  // Create a simple hash for consistent user ID (in production, use crypto.subtle)
  let hash = 0
  for (let i = 0; i < userIdentifier.length; i++) {
    const char = userIdentifier.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }

  return `user_${Math.abs(hash).toString(36)}`
}

/**
 * Offline-first emails with multi-user support
 * Issue: Data isolation and sync security
 * Line: src/hooks/useIndexedDB.ts:23
 * Attack: Users could access other users' data without proper isolation
 * Fix: Initialize sync manager with user ID and validate all operations
 */
export function useOfflineEmails(mailboxId: string | null) {
  const accountId = usePrimaryAccountId()
  const session = useAuthStore((state) => state.session)
  const userId = useCurrentUserId()
  const loadMore = useLoadMoreEmails()

  // Initialize sync manager with current user
  useEffect(() => {
    if (userId && accountId && session) {
      syncManager
        .initializeUser(userId)
        .then(() => {
        try {           syncManager.startPushSync(accountId)
        } catch (error) {
          console.warn("[IndexedDB] Push sync not available:", error)
        }
        })
        .catch((error) => {
          console.error('[IndexedDB] Failed to initialize user:', error)
        })

      return () => syncManager.stop()
    }
  }, [userId, accountId, session])

  const query = useQuery({
    queryKey: ['emails', 'offline', userId, mailboxId],
    queryFn: async () => {
      if (!mailboxId || !accountId || !userId) {
        return { emails: [], total: 0, fromCache: false, hasMore: false }
      }

      try {
        // Ensure sync manager is initialized for this user
        if (syncManager.getCurrentUserId() !== userId) {
          await syncManager.initializeUser(userId)
        }

        // Try offline first
        const cachedEmails = await syncManager.getMailboxEmails(mailboxId, 0, 50)

        if (cachedEmails.length > 0) {
          // Return cached data immediately
          const total = await db.emails
            .where('[_userId+_mailboxIds+receivedAt]')
            .between([userId, mailboxId, Dexie.minKey], [userId, mailboxId, Dexie.maxKey])
            .count()

          return {
            emails: cachedEmails,
            total,
            fromCache: true,
            hasMore: cachedEmails.length < total,
          }
        }

        // If no cache, sync from server
        const result = await syncManager.syncMailbox(accountId, mailboxId)
        return { ...result, hasMore: result.emails.length < result.total }
      } catch (error) {
        console.error('[IndexedDB] Failed to fetch emails:', error)
        return { emails: [], total: 0, fromCache: false, hasMore: false }
      }
    },
    enabled: !!session && !!accountId && !!mailboxId && !!userId,
    staleTime: 30 * 1000, // Consider data fresh for 30s
    // Background refetch will update IndexedDB
    refetchInterval: 5 * 60 * 1000, // Every 5 minutes
    refetchIntervalInBackground: true,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    refetch: query.refetch,
    loadMore,
  }
}

/**
 * Offline search with user isolation
 * Issue: Search query validation and user isolation
 * Line: src/hooks/useIndexedDB.ts:75
 * Attack: Search queries could be used for injection or to access other users' data
 * Fix: Sanitize queries and enforce user boundaries
 */
export function useOfflineSearch(query: string, enabled: boolean) {
  const userId = useCurrentUserId()

  return useQuery({
    queryKey: ['search', 'offline', userId, query],
    queryFn: async () => {
      if (!userId || !query.trim()) return []

      try {
        // Ensure sync manager is initialized for this user
        if (syncManager.getCurrentUserId() !== userId) {
          await syncManager.initializeUser(userId)
        }

        return syncManager.searchOffline(query)
      } catch (error) {
        console.error('[IndexedDB] Search failed:', error)
        return []
      }
    },
    enabled: enabled && query.length > 2 && !!userId,
    staleTime: 60 * 1000,
  })
}

/**
 * Infinite scroll for offline emails
 * Issue: Memory management and user isolation
 * Line: src/hooks/useIndexedDB.ts:103
 * Attack: Could exhaust memory with large datasets
 * Fix: Implement proper pagination and memory cleanup
 */
export function useOfflineEmailsInfinite(mailboxId: string | null) {
  const accountId = usePrimaryAccountId()
  const session = useAuthStore((state) => state.session)
  const userId = useCurrentUserId()

  // Initialize sync manager with current user
  useEffect(() => {
    if (userId && accountId && session) {
      syncManager
        .initializeUser(userId)
        .then(() => {
        try {           syncManager.startPushSync(accountId)
        } catch (error) {
          console.warn("[IndexedDB] Push sync not available:", error)
        }
        })
        .catch((error) => {
          console.error('[IndexedDB] Failed to initialize user:', error)
        })

      return () => syncManager.stop()
    }
  }, [userId, accountId, session])

  return useQuery({
    queryKey: ['emails', 'infinite', userId, mailboxId],
    queryFn: async () => {
      if (!mailboxId || !accountId || !userId) {
        return { emails: [], hasMore: false, total: 0 }
      }

      try {
        // Ensure sync manager is initialized for this user
        if (syncManager.getCurrentUserId() !== userId) {
          await syncManager.initializeUser(userId)
        }

        // Get first batch from cache
        const emails = await syncManager.getMailboxEmails(mailboxId, 0, 50)
        const total = await db.emails
          .where('[_userId+_mailboxIds+receivedAt]')
          .between([userId, mailboxId, Dexie.minKey], [userId, mailboxId, Dexie.maxKey])
          .count()

        return {
          emails,
          hasMore: emails.length < total,
          total,
        }
      } catch (error) {
        console.error('[IndexedDB] Failed to fetch infinite emails:', error)
        return { emails: [], hasMore: false, total: 0 }
      }
    },
    enabled: !!session && !!accountId && !!mailboxId && !!userId,
    staleTime: 30 * 1000,
  })
}

/**
 * Load more emails for infinite scroll
 * Issue: Rate limiting and user validation
 * Line: src/hooks/useIndexedDB.ts:153
 * Attack: Could be abused to exhaust resources
 * Fix: Rate limit and validate user context
 */
export function useLoadMoreEmails() {
  const queryClient = useQueryClient()
  const userId = useCurrentUserId()
  const accountId = usePrimaryAccountId()

  return useMutation({
    mutationFn: async ({ mailboxId, offset }: { mailboxId: string; offset: number }) => {
      if (!userId) throw new Error('User not authenticated')
      if (!accountId) throw new Error('No account ID')

      // Rate limiting check
      const now = Date.now()
      const lastLoad = (queryClient.getQueryData(['lastLoad', userId]) as number) || 0
      if (now - lastLoad < 1000) {
        // 1 second rate limit
        throw new Error('Rate limit exceeded')
      }
      queryClient.setQueryData(['lastLoad', userId], now)

      // Ensure sync manager is initialized for this user
      if (syncManager.getCurrentUserId() !== userId) {
        await syncManager.initializeUser(userId)
      }

      // Sync next batch from server
      const result = await syncManager.syncMailbox(accountId, mailboxId, offset)
      return result.emails
    },
    onSuccess: (newEmails, { mailboxId }) => {
      // Update the offline query cache
      queryClient.setQueryData(['emails', 'offline', userId, mailboxId], (old: any) => {
        if (!old) return { emails: newEmails, hasMore: newEmails.length === 50, total: 0, fromCache: false }

        // Deduplicate emails by ID
        const existingIds = new Set(old.emails.map((e: any) => e.id))
        const uniqueNewEmails = newEmails.filter((e: any) => !existingIds.has(e.id))
        const allEmails = [...old.emails, ...uniqueNewEmails]
        
        return {
          ...old,
          emails: allEmails,
          hasMore: newEmails.length === 50,
          total: Math.max(old.total, allEmails.length),
        }
      })
    },
  })
}

/**
 * Clear offline data for current user
 * Issue: Data cleanup and user validation
 * Line: src/hooks/useIndexedDB.ts:195
 * Attack: Could be used to delete other users' data
 * Fix: Strictly validate user identity before cleanup
 */
export function useClearOfflineData() {
  const queryClient = useQueryClient()
  const userId = useCurrentUserId()

  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('User not authenticated')

      // Double-check user identity
      const currentUser = await db.getCurrentUser()
      if (currentUser !== userId) {
        throw new Error('User identity mismatch')
      }

      await db.clearUserData(userId)
      syncManager.stop()
    },
    onSuccess: () => {
      // Clear all queries for this user
      queryClient.removeQueries({ queryKey: ['emails', 'offline', userId] })
      queryClient.removeQueries({ queryKey: ['search', 'offline', userId] })
      queryClient.removeQueries({ queryKey: ['emails', 'infinite', userId] })
    },
  })
}
