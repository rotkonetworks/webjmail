import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { jmapClient } from '../../api/jmap'
import { useAuthStore } from '../../stores/authStore'
import { useUnreadStore, UNIFIED_CACHE_KEY } from '../../stores/unreadStore'
import type { Email } from '../../api/types'

export type UnifiedEmail = Email & { _account: string }

interface UnifiedData {
  emails: UnifiedEmail[]
  unreadByAccount: Record<string, number>
}

// Offline cache (survives restarts): show the last merged view instantly, then
// revalidate. Headers only (no bodies), capped, so it stays small.
function readCache(): UnifiedData | undefined {
  try {
    const raw = localStorage.getItem(UNIFIED_CACHE_KEY)
    return raw ? (JSON.parse(raw) as UnifiedData) : undefined
  } catch {
    return undefined
  }
}
function writeCache(data: UnifiedData) {
  try {
    localStorage.setItem(
      UNIFIED_CACHE_KEY,
      JSON.stringify({ emails: data.emails.slice(0, 300), unreadByAccount: data.unreadByAccount })
    )
  } catch {
    /* ignore quota errors */
  }
}

/**
 * Merged inbox across every account. Queries each account's Inbox in parallel
 * (independent of the active account), tags each email with its account, sorts
 * the union by receivedAt desc, and tracks per-account unread counts. Cached to
 * localStorage for instant offline display; revalidates in the background.
 */
export function useUnifiedInbox(limitPerAccount = 50) {
  const accounts = useAuthStore((s) => s.accounts)
  const names = accounts.map((a) => a.name)

  const query = useQuery<UnifiedData>({
    queryKey: ['unified-inbox', names],
    queryFn: async () => {
      const per = await Promise.all(
        names.map(async (name) => {
          try {
            const session = await jmapClient.getAccountSession(name)
            const { emails, unread } = await jmapClient.getAccountInbox(session, name, limitPerAccount)
            return {
              name,
              emails: emails.map((e) => ({ ...e, _account: name }) as UnifiedEmail),
              unread,
            }
          } catch (err) {
            if (import.meta.env.DEV) console.error('[Unified] account failed:', name, err)
            return { name, emails: [] as UnifiedEmail[], unread: 0 }
          }
        })
      )
      const emails = per
        .flatMap((p) => p.emails)
        .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0))
      const unreadByAccount: Record<string, number> = {}
      per.forEach((p) => {
        unreadByAccount[p.name] = p.unread
      })
      const result: UnifiedData = { emails, unreadByAccount }
      writeCache(result)
      return result
    },
    enabled: names.length > 0,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: false,
    initialData: readCache,
    // Treat the cached copy as stale so it shows instantly but still revalidates.
    initialDataUpdatedAt: 0,
  })

  // Mirror unread counts into the global store for sidebar/switcher badges.
  const data = query.data
  useEffect(() => {
    if (data) useUnreadStore.getState().setByAccount(data.unreadByAccount)
  }, [data])

  const totalUnread = data
    ? Object.values(data.unreadByAccount).reduce((a, b) => a + b, 0)
    : 0

  return {
    emails: data?.emails ?? [],
    unreadByAccount: data?.unreadByAccount ?? {},
    totalUnread,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  }
}
