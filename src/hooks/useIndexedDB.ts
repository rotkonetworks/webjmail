// src/hooks/useIndexedDB.ts
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { syncManager } from '../db/sync'
import { useAuthStore } from '../stores/authStore'
import { usePrimaryAccountId } from './usePrimaryAccountId'
import { jmapClient } from '../api/jmap'

export function useCurrentUserId(): string | null {
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
 * Mount once in the authenticated shell. Runs the delta sync for the active
 * account (initial reconcile, then changes on launch / push / poll) into the
 * local IndexedDB mirror that every list reads live. Works in the browser and
 * the desktop build alike; push is desktop-only.
 */
export function useLocalIndex() {
  const accountId = usePrimaryAccountId()
  const userId = useCurrentUserId()

  useEffect(() => {
    if (!userId || !accountId) return
    let cancelled = false
    syncManager
      .initializeUser(userId)
      .then(() => {
        if (cancelled) return
        syncManager.start(accountId, userId)
        // One-shot: report whether the server speaks JMAP Calendars (see console).
        void jmapClient.probeCalendars()
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.error('[LocalIndex] init failed:', error)
      })

    // Refresh signals from the UI (sidebar refresh, etc.) → delta sync.
    const onChange = () => void syncManager.syncNow()
    window.addEventListener('jmap-changed', onChange)
    window.addEventListener('mailbox-changed', onChange)
    return () => {
      cancelled = true
      window.removeEventListener('jmap-changed', onChange)
      window.removeEventListener('mailbox-changed', onChange)
      syncManager.stop()
    }
  }, [userId, accountId])
}

export function useOfflineSearch(query: string, enabled: boolean) {
  const userId = useCurrentUserId()
  const accountId = usePrimaryAccountId()

  return useQuery({
    queryKey: ['search', 'offline', userId, query],
    queryFn: async () => {
      if (!userId || !query.trim()) return []

      try {
        // Ensure sync manager is initialized for this user
        if (syncManager.getCurrentUserId() !== userId) {
          await syncManager.initializeUser(userId)
        }

        // Get offline results first
        const offlineResults = await syncManager.searchOffline(query)
        
        // Bug 8: Enhanced search fallback - if results are sparse, fetch from server
        if (offlineResults.length < 5 && accountId) {
          try {
            const serverResults = await jmapClient.searchEmails(accountId, query)
            
            // Merge and deduplicate results (offline first, then server)
            const allResults = [...offlineResults]
            const offlineIds = new Set(offlineResults.map(e => e.id))
            
            for (const serverResult of serverResults) {
              if (!offlineIds.has(serverResult.id)) {
                allResults.push(serverResult)
              }
            }
            
            return allResults.slice(0, 50) // Limit total results
          } catch (serverError) {
            if (import.meta.env.DEV) {
              console.log('[IndexedDB] Server search fallback failed, using offline only:', serverError)
            }
            return offlineResults
          }
        }

        return offlineResults
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('[IndexedDB] Search failed:', error)
        }
        return []
      }
    },
    enabled: enabled && query.length > 2 && !!userId,
    staleTime: 60 * 1000,
  })
}
