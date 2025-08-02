import React from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { jmapClient } from '../../api/jmap'
import { useAuthStore } from '../../stores/authStore'
import { useMailStore } from '../../stores/mailStore'
import { usePrimaryAccountId } from '../usePrimaryAccountId'
import type { Email } from '../../api/types'

interface EmailsResponse {
  emails: Email[]
  total: number
  position: number
}

export function useEmails(mailboxId: string | null) {
  const session = useAuthStore((state) => state.session)
  const accountId = usePrimaryAccountId()
  const setEmails = useMailStore((state) => state.addEmails)

  const query = useInfiniteQuery<EmailsResponse>({
    queryKey: ['emails', accountId, mailboxId],
    queryFn: async ({ pageParam }) => {
      const position = pageParam ?? 0
      if (!accountId || !mailboxId) return { emails: [], total: 0, position: 0 }

      if (import.meta.env.DEV) {
        console.log('[useEmails] Fetching emails at position:', position)
      }
      
      const result = await jmapClient.getEmails(
        accountId,
        { inMailbox: mailboxId },
        undefined,
        position as number,
        50
      )

      if (import.meta.env.DEV) {
        console.log('[useEmails] Fetched:', result.emails.length, 'emails, total:', result.total)
      }
      
      return result
    },
    getNextPageParam: (lastPage: EmailsResponse, allPages: EmailsResponse[]) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.emails.length, 0)
      if (import.meta.env.DEV) {
        console.log('[useEmails] Loaded:', loadedCount, 'of', lastPage.total)
      }
      
      if (loadedCount >= lastPage.total) {
        return undefined
      }
      
      return loadedCount
    },
    initialPageParam: 0,
    enabled: !!session && !!accountId && !!mailboxId,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 2 * 60 * 1000, // Poll every 2 minutes
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes('401')) {
        console.error('[useEmails] Got 401, not retrying')
        return false
      }
      return failureCount < 3
    },
  })

  // Update store when data changes
  React.useEffect(() => {
    if (query.data) {
      const allEmails = query.data.pages.flatMap((page) => page.emails)
      setEmails(allEmails)
      console.log('[useEmails] Updated store with', allEmails.length, 'emails')
    }
  }, [query.data, setEmails])

  // Calculate derived state
  const emails = query.data?.pages.flatMap((page) => page.emails) ?? []
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
    refetch: query.refetch,
  }
}
