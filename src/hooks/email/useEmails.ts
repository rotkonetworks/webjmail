import React from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/authStore'
import { useMailStore } from '../../stores/mailStore'
import { usePrimaryAccountId } from '../usePrimaryAccountId'
import { useCurrentUserId } from '../useIndexedDB'
import { syncManager } from '../../db/sync'
import { config } from '../../config'
import type { Email } from '../../api/types'

interface EmailsResponse {
  emails: Email[]
  total: number
  position: number
}

const PAGE_SIZE = 50

/**
 * Local-first inbox list.
 *
 * The list is served from the IndexedDB cache so it renders instantly on launch
 * (no "reload everything from the server" flash) and works offline. A quiet
 * background revalidation fetches the newest page from the server, writes it
 * through to the cache, and refreshes the view — stale-while-revalidate. Falls
 * back to a direct server fetch only when a page isn't cached yet (e.g. first
 * run before the full index has populated, or scrolling past the cached range).
 */
export function useEmails(mailboxId: string | null) {
  const session = useAuthStore((state) => state.session)
  const accountId = usePrimaryAccountId()
  const userId = useCurrentUserId()
  const addEmails = useMailStore((state) => state.addEmails)
  const queryClient = useQueryClient()

  // Server total for the mailbox, learned during revalidation. Used so the list
  // can keep paginating even when the cache is only partially populated.
  const serverTotalRef = React.useRef(0)

  const queryKey = ['emails', accountId, mailboxId] as const

  const query = useInfiniteQuery<EmailsResponse>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const position = (pageParam as number) ?? 0
      if (!accountId || !mailboxId || !userId) return { emails: [], total: 0, position: 0 }

      await syncManager.ensureUser(userId)

      // Cache-first: serve this page straight from IndexedDB when we have it.
      const cached = await syncManager.getCachedEmails(userId, mailboxId, position, PAGE_SIZE)
      if (cached.length > 0) {
        const cachedTotal = await syncManager.countCachedEmails(userId, mailboxId)
        return {
          emails: cached,
          total: Math.max(cachedTotal, serverTotalRef.current),
          position,
        }
      }

      // Cache miss → fetch from the server and write it through to the cache.
      const result = await syncManager.fetchAndCacheEmails(
        accountId,
        userId,
        mailboxId,
        position,
        PAGE_SIZE
      )
      serverTotalRef.current = result.total
      return result
    },
    getNextPageParam: (lastPage: EmailsResponse, allPages: EmailsResponse[]) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.emails.length, 0)
      if (loadedCount >= lastPage.total) return undefined
      return loadedCount
    },
    initialPageParam: 0,
    enabled: !!session && !!accountId && !!mailboxId && !!userId,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  })

  // Background revalidation: pull the newest page from the server into the cache,
  // then re-read the list from cache. Used on mailbox open, on a poll interval,
  // and on push/manual-refresh signals. Kept out of the query itself so a
  // refresh never blanks the already-rendered cached list.
  const revalidate = React.useCallback(async () => {
    if (!accountId || !mailboxId || !userId) return
    try {
      await syncManager.ensureUser(userId)
      const result = await syncManager.fetchAndCacheEmails(
        accountId,
        userId,
        mailboxId,
        0,
        PAGE_SIZE
      )
      serverTotalRef.current = result.total
      // Re-read every loaded page from the now-fresh cache (no extra server hits).
      queryClient.invalidateQueries({ queryKey })
    } catch (error) {
      if (import.meta.env.DEV) console.error('[useEmails] revalidate failed:', error)
    }
    // queryKey is derived from these deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, mailboxId, userId, queryClient])

  // Revalidate when the mailbox opens and on a polling interval (the desktop
  // build has no push, so polling is the refresh path there).
  React.useEffect(() => {
    if (!accountId || !mailboxId || !userId) return
    revalidate()
    const id = window.setInterval(revalidate, config.performance.refetchIntervalMs)
    return () => window.clearInterval(id)
  }, [accountId, mailboxId, userId, revalidate])

  // Live refresh on change signals (web push, manual refresh broadcast).
  React.useEffect(() => {
    const onChange = () => revalidate()
    window.addEventListener('jmap-changed', onChange)
    window.addEventListener('mailbox-changed', onChange)
    return () => {
      window.removeEventListener('jmap-changed', onChange)
      window.removeEventListener('mailbox-changed', onChange)
    }
  }, [revalidate])

  // Update store when data changes
  React.useEffect(() => {
    if (query.data) {
      const allEmails = query.data.pages.flatMap((page) => page.emails)
      if (allEmails.length > 0) {
        addEmails(allEmails)
      }
    }
  }, [query.data, addEmails])

  const emails = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.emails) ?? [],
    [query.data]
  )

  const total = query.data?.pages[0]?.total ?? 0
  const hasMore = query.hasNextPage ?? false

  return {
    emails,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasMore,
    total,
    fetchNextPage: query.fetchNextPage,
    // Refresh button → force a server revalidation (not just a cache re-read).
    refetch: revalidate,
  }
}
