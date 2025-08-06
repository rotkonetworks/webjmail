import React from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
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
  const addEmails = useMailStore((state) => state.addEmails)

  const query = useInfiniteQuery<EmailsResponse>({
    queryKey: ['emails', accountId, mailboxId],
    queryFn: async ({ pageParam }) => {
      const position = pageParam ?? 0
      if (!accountId || !mailboxId) return { emails: [], total: 0, position: 0 }

      console.log('[useEmails] Fetching emails for mailbox:', mailboxId, 'position:', position)

      const result = await jmapClient.getEmails(
        accountId,
        { inMailbox: mailboxId },
        undefined,
        position as number,
        50
      )

      console.log('[useEmails] Received emails:', result.emails.length, 'total:', result.total)

      return result
    },
    getNextPageParam: (lastPage: EmailsResponse, allPages: EmailsResponse[]) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.emails.length, 0)
      
      if (loadedCount >= lastPage.total) {
        return undefined
      }

      return loadedCount
    },
    initialPageParam: 0,
    enabled: !!session && !!accountId && !!mailboxId,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  })

  // Update store when data changes
  React.useEffect(() => {
    if (query.data) {
      const allEmails = query.data.pages.flatMap((page) => page.emails)
      console.log('[useEmails] Updating store with emails:', allEmails.length)
      if (allEmails.length > 0) {
        console.log('[useEmails] First email:', allEmails[0])
      }
      addEmails(allEmails)
    }
  }, [query.data, addEmails])

  // Get emails directly from query data, not from store
  const emails = React.useMemo(() => {
    const result = query.data?.pages.flatMap((page) => page.emails) ?? []
    console.log('[useEmails] Returning emails:', result.length)
    return result
  }, [query.data])
  
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
