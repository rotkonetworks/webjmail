import React from 'react'
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { jmapClient } from '../api/jmap'
import { useAuthStore } from '../stores/authStore'
import { useMailStore } from '../stores/mailStore'

export function usePrimaryAccountId() {
  const session = useAuthStore((state) => state.session)
  return session?.primaryAccounts?.['urn:ietf:params:jmap:mail'] || null
}

export function useMailboxes() {
  const session = useAuthStore((state) => state.session)
  const accountId = usePrimaryAccountId()
  const setMailboxes = useMailStore((state) => state.setMailboxes)

  return useQuery({
    queryKey: ['mailboxes', accountId],
    queryFn: async () => {
      if (!accountId) throw new Error('No account ID')
      const mailboxes = await jmapClient.getMailboxes(accountId)
      setMailboxes(mailboxes)
      return mailboxes
    },
    enabled: !!session && !!accountId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useEmailSearch(query: string, enabled: boolean) {
  const accountId = usePrimaryAccountId()
  const session = useAuthStore((state) => state.session)
  
  return useQuery({
    queryKey: ['search', accountId, query],
    queryFn: async () => {
      if (!accountId || !query.trim()) return []
      return jmapClient.searchEmails(accountId, query)
    },
    enabled: !!session && !!accountId && enabled && query.length > 2,
    staleTime: 30 * 1000, // 30 seconds
  })
}
export function useEmails(mailboxId: string | null) {
  const session = useAuthStore((state) => state.session)
  const accountId = usePrimaryAccountId()
  const setEmails = useMailStore((state) => state.setEmails)
  const [hasMore, setHasMore] = React.useState(true)
  const [total, setTotal] = React.useState(0)

  const query = useInfiniteQuery({
    queryKey: ['emails', accountId, mailboxId],
    queryFn: async ({ pageParam = 0 }) => {
      if (!accountId || !mailboxId) return { emails: [], total: 0, position: 0 }

      const result = await jmapClient.getEmails(
        accountId,
        { inMailbox: mailboxId },
        undefined,
        pageParam,
        50
      )
      
      return result
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.emails.length, 0)
      if (loadedCount >= lastPage.total) {
        return undefined
      }
      return loadedCount
    },
    enabled: !!session && !!accountId && !!mailboxId,
    staleTime: 1 * 60 * 1000,
  })

  // Update store when data changes
  React.useEffect(() => {
    if (query.data) {
      const allEmails = query.data.pages.flatMap(page => page.emails)
      setEmails(allEmails)
      
      const lastPage = query.data.pages[query.data.pages.length - 1]
      setTotal(lastPage.total)
      setHasMore(query.hasNextPage ?? false)
    }
  }, [query.data, setEmails])

  return {
    emails: query.data?.pages.flatMap(page => page.emails) ?? [],
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasMore,
    total,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  }
}

export function useEmailThread(threadId: string | null) {
  const accountId = usePrimaryAccountId()
  const session = useAuthStore((state) => state.session)

  return useQuery({
    queryKey: ['thread', accountId, threadId],
    queryFn: async () => {
      if (!accountId || !threadId) return []
      return jmapClient.getEmailThread(accountId, threadId)
    },
    enabled: !!session && !!accountId && !!threadId,
    staleTime: 2 * 60 * 1000,
  })
}

export function useMarkAsRead() {
  const queryClient = useQueryClient()
  const accountId = usePrimaryAccountId()
  const updateEmail = useMailStore((state) => state.updateEmail)

  return useMutation({
    mutationFn: async ({
      emailId,
      isRead,
    }: {
      emailId: string
      isRead: boolean
    }) => {
      if (!accountId) throw new Error('No account ID')
      
      const update = {
        [emailId]: {
          keywords: {
            $seen: isRead,
          },
        },
      }

      const result = await jmapClient.setEmail(accountId, update)
      return result
    },
    onSuccess: (_, { emailId, isRead }) => {
      updateEmail(emailId, {
        keywords: { $seen: isRead },
      })
    },
    onSettled: () => {
      if (accountId) {
        queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
      }
    },
  })
}

export function useMoveEmail() {
  const queryClient = useQueryClient()
  const updateEmail = useMailStore((state) => state.updateEmail)

  return useMutation({
    mutationFn: async ({
      accountId,
      emailId,
      fromMailboxId,
      toMailboxId,
    }: {
      accountId: string
      emailId: string
      fromMailboxId: string
      toMailboxId: string
    }) => {
      const update = {
        [emailId]: {
          mailboxIds: {
            [fromMailboxId]: false,
            [toMailboxId]: true,
          },
        },
      }

      const result = await jmapClient.setEmail(accountId, update)
      return result
    },
    onSuccess: (_, { emailId, fromMailboxId, toMailboxId }) => {
      // Update local state
      updateEmail(emailId, {
        mailboxIds: {
          [fromMailboxId]: false,
          [toMailboxId]: true,
        },
      })
    },
    onSettled: (_, __, { accountId }) => {
      // Refresh email lists
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    },
  })
}

export function useDeleteEmail() {
  const queryClient = useQueryClient()
  const deleteEmailFromStore = useMailStore((state) => state.deleteEmail)

  return useMutation({
    mutationFn: async ({
      accountId,
      emailId,
    }: {
      accountId: string
      emailId: string
    }) => {
      const result = await jmapClient.request([
        ['Email/set', {
          accountId,
          destroy: [emailId],
        }, '0'],
      ])
      
      return result
    },
    onSuccess: (_, { emailId }) => {
      // Remove from local state
      deleteEmailFromStore(emailId)
    },
    onSettled: (_, __, { accountId }) => {
      // Refresh email lists
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    },
  })
}

export function useFlagEmail() {
  const queryClient = useQueryClient()
  const updateEmail = useMailStore((state) => state.updateEmail)

  return useMutation({
    mutationFn: async ({
      accountId,
      emailId,
      isFlagged,
    }: {
      accountId: string
      emailId: string
      isFlagged: boolean
    }) => {
      const update = {
        [emailId]: {
          keywords: {
            $flagged: isFlagged,
          },
        },
      }

      const result = await jmapClient.setEmail(accountId, update)
      return result
    },
    onSuccess: (_, { emailId, isFlagged }) => {
      updateEmail(emailId, {
        keywords: { $flagged: isFlagged },
      })
    },
    onSettled: (_, __, { accountId }) => {
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    },
  })
}

export function useSendEmail() {
  const queryClient = useQueryClient()
  const accountId = usePrimaryAccountId()
  const session = useAuthStore((state) => state.session)
  const mailboxes = useMailStore((state) => state.mailboxes)

  return useMutation({
    mutationFn: async ({
      to,
      cc,
      bcc,
      subject,
      textBody,
      htmlBody,
      inReplyTo,
      attachments,
    }: {
      to: Array<{ name?: string; email: string }>
      cc?: Array<{ name?: string; email: string }>
      bcc?: Array<{ name?: string; email: string }>
      subject: string
      textBody?: string
      htmlBody?: string
      inReplyTo?: string
      attachments?: Array<{ blobId: string; type: string; name: string }>
    }) => {
      if (!accountId) throw new Error('No account ID')
      if (!session) throw new Error('No session')

      // Find drafts and sent mailboxes
      const draftsMailbox = Object.values(mailboxes).find(m => m.role === 'drafts')
      const sentMailbox = Object.values(mailboxes).find(m => m.role === 'sent')

      const emailId = `draft-${Date.now()}`
      
      const result = await jmapClient.request([
        // Create the email
        ['Email/set', {
          accountId,
          create: {
            [emailId]: {
              mailboxIds: draftsMailbox ? { [draftsMailbox.id]: true } : {},
              from: [{ 
                name: session.accounts[accountId]?.name || session.username,
                email: session.username 
              }],
              to,
              cc,
              bcc,
              subject,
              keywords: {
                $draft: true,
                $seen: true,
              },
              bodyStructure: {
                type: 'multipart/alternative',
                subParts: [
                  ...(textBody ? [{
                    type: 'text/plain',
                    partId: '1',
                  }] : []),
                  ...(htmlBody ? [{
                    type: 'text/html',
                    partId: '2',
                  }] : []),
                ],
              },
              bodyValues: {
                ...(textBody ? { '1': { value: textBody } } : {}),
                ...(htmlBody ? { '2': { value: htmlBody } } : {}),
              },
              ...(inReplyTo ? { 
                inReplyTo: [inReplyTo],
                references: [inReplyTo],
              } : {}),
              ...(attachments ? { attachments } : {}),
            },
          },
        }, '0'],
        // Send the email
        ['EmailSubmission/set', {
          accountId,
          create: {
            submission1: {
              emailId: `#${emailId}`,
              envelope: {
                mailFrom: { email: session.username },
                rcptTo: [
                  ...to.map(addr => ({ email: addr.email })),
                  ...(cc || []).map(addr => ({ email: addr.email })),
                  ...(bcc || []).map(addr => ({ email: addr.email })),
                ],
              },
            },
          },
          onSuccessUpdateEmail: {
            [`#submission1`]: {
              mailboxIds: sentMailbox ? { [sentMailbox.id]: true } : {},
              keywords: {
                $draft: null,
                $sent: true,
              },
            },
          },
        }, '1'],
      ])

      return result
    },
    onSuccess: () => {
      // Refresh emails in current mailbox
      if (accountId) {
        queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
      }
    },
  })
}
