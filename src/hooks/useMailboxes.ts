import { useQuery, useQueryClient } from '@tanstack/react-query'
import { jmapClient } from '../api/jmap'
import { useAuthStore } from '../stores/authStore'
import { useMailStore } from '../stores/mailStore'
import { usePrimaryAccountId } from './usePrimaryAccountId'
import { useCurrentUserId } from './useIndexedDB'
import { syncManager } from '../db/sync'

/**
 * Local-first folder list. Renders the cached mailboxes from IndexedDB instantly
 * on launch, then refreshes from the server in the background and only re-renders
 * if anything actually changed.
 */
export function useMailboxes() {
  const session = useAuthStore((state) => state.session)
  const accountId = usePrimaryAccountId()
  const userId = useCurrentUserId()
  const setMailboxes = useMailStore((state) => state.setMailboxes)
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: ['mailboxes', accountId],
    queryFn: async () => {
      if (!accountId) throw new Error('No account ID')
      if (!userId) {
        // No user context yet — fetch without persisting to avoid a bad cache key.
        const fresh = await jmapClient.getMailboxes(accountId)
        setMailboxes(fresh)
        return fresh
      }

      await syncManager.ensureUser(userId)
      const cached = await syncManager.getCachedMailboxes(userId)

      if (cached.length > 0) {
        setMailboxes(cached)
        // Background refresh; only invalidate (re-render) if the server differs.
        syncManager
          .fetchAndCacheMailboxes(accountId, userId)
          .then((fresh) => {
            if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
              queryClient.invalidateQueries({ queryKey: ['mailboxes', accountId] })
            }
          })
          .catch((e) => {
            if (import.meta.env.DEV) console.error('[useMailboxes] refresh failed:', e)
          })
        return cached
      }

      // Cold cache → fetch from the server and persist.
      const fresh = await syncManager.fetchAndCacheMailboxes(accountId, userId)
      setMailboxes(fresh)
      return fresh
    },
    enabled: !!session && !!accountId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: (failureCount, error) => {
      // Don't retry on 401 errors
      if (error instanceof Error && error.message.includes('401')) {
        return false
      }
      return failureCount < 3
    },
  })
}
