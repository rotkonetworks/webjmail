// src/hooks/useJMAP.ts - Fixed email sending
import React from 'react'
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { jmapClient } from '../api/jmap'
import { useAuthStore } from '../stores/authStore'
import { useMailStore } from '../stores/mailStore'

export function usePrimaryAccountId() {
  const session = useAuthStore((state) => state.session)
  const accountId = session?.primaryAccounts?.['urn:ietf:params:jmap:mail'] || null
  
  if (import.meta.env.DEV) {
    console.log('[useJMAP] Primary account ID:', accountId)
  }
  
  return accountId
}

export function useMailboxes() {
  const session = useAuthStore((state) => state.session)
  const accountId = usePrimaryAccountId()
  const setMailboxes = useMailStore((state) => state.setMailboxes)

  return useQuery({
    queryKey: ['mailboxes', accountId],
    queryFn: async () => {
      if (!accountId) throw new Error('No account ID')
      
      if (import.meta.env.DEV) {
        console.log('[useMailboxes] Fetching mailboxes for account:', accountId)
      }
      
      const mailboxes = await jmapClient.getMailboxes(accountId)
      setMailboxes(mailboxes)
      
      if (import.meta.env.DEV) {
        console.log('[useMailboxes] Fetched mailboxes:', mailboxes.length)
      }
      
      return mailboxes
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
  const setEmails = useMailStore((state) => state.addEmails)
  const queryClient = useQueryClient()

  const query = useInfiniteQuery({
    queryKey: ['emails', accountId, mailboxId],
    queryFn: async ({ pageParam = 0 }) => {
      if (!accountId || !mailboxId) return { emails: [], total: 0, position: 0 }

      if (import.meta.env.DEV) {
        console.log('[useEmails] Fetching emails at position:', pageParam)
      }
      
      const result = await jmapClient.getEmails(
        accountId,
        { inMailbox: mailboxId },
        undefined,
        pageParam,
        50
      )

      if (import.meta.env.DEV) {
        console.log('[useEmails] Fetched:', result.emails.length, 'emails, total:', result.total)
      }
      
      return result
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.emails.length, 0)
      if (import.meta.env.DEV) {
        console.log('[useEmails] Loaded:', loadedCount, 'of', lastPage.total)
      }
      
      if (loadedCount >= lastPage.total) {
        return undefined
      }
      
      return loadedCount
    },
    enabled: !!session && !!accountId && !!mailboxId,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 2 * 60 * 1000, // Poll every 2 minutes
    keepPreviousData: true,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
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

// Manual refresh hook
export function useManualRefresh() {
  const queryClient = useQueryClient()
  const accountId = usePrimaryAccountId()

  return React.useCallback(() => {
    console.log('[Manual Refresh] Refreshing all queries')
    queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    queryClient.invalidateQueries({ queryKey: ['mailboxes', accountId] })
  }, [queryClient, accountId])
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
    mutationFn: async ({ emailId, isRead }: { emailId: string; isRead: boolean }) => {
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
      
      if (accountId) {
        queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
      }
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
    onSuccess: (_, { emailId, isFlagged, accountId }) => {
      updateEmail(emailId, {
        keywords: { $flagged: isFlagged },
      })
      
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    },
  })
}

export function useDeleteEmail() {
  const queryClient = useQueryClient()
  const deleteEmailFromStore = useMailStore((state) => state.deleteEmail)

  return useMutation({
    mutationFn: async ({ accountId, emailId }: { accountId: string; emailId: string }) => {
      const result = await jmapClient.request([
        [
          'Email/set',
          {
            accountId,
            destroy: [emailId],
          },
          '0',
        ],
      ])

      return result
    },
    onSuccess: (_, { emailId, accountId }) => {
      deleteEmailFromStore(emailId)
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    },
  })
}

export function useSendEmail() {
  const queryClient = useQueryClient()
  const accountId = usePrimaryAccountId()
  const session = useAuthStore((state) => state.session)

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

      console.log('[useSendEmail] Sending email:', { to, subject })

      // Validation logic...
      if (!to || to.length === 0) {
        throw new Error('At least one recipient is required')
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      const validateEmailAddresses = (
        addresses: Array<{ name?: string; email: string }>,
        fieldName: string
      ) => {
        for (const addr of addresses) {
          if (!addr.email || !emailRegex.test(addr.email)) {
            throw new Error(`Invalid email address in ${fieldName}: ${addr.email}`)
          }
        }
      }

      validateEmailAddresses(to, 'to')
      if (cc) validateEmailAddresses(cc, 'cc')
      if (bcc) validateEmailAddresses(bcc, 'bcc')

      // Find the drafts mailbox
      const mailboxes = await jmapClient.getMailboxes(accountId)
      const draftsMailbox = mailboxes.find(m => m.role === 'drafts')
      const sentMailbox = mailboxes.find(m => m.role === 'sent')
      
      // Create a temporary email ID for the creation reference
      const tempEmailId = 'draft-1'

      const emailData: any = {
        mailboxIds: draftsMailbox ? { [draftsMailbox.id]: true } : {},
        from: [
          {
            name: session.accounts[accountId]?.name || null,
            email: session.username,
          },
        ],
        to,
        subject: subject || '',
        keywords: {
          $draft: true,
          $seen: true,
        },
        sentAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
      }

      if (cc && cc.length > 0) emailData.cc = cc
      if (bcc && bcc.length > 0) emailData.bcc = bcc

      // Set up the body
      if (textBody || !htmlBody) {
        emailData.bodyStructure = {
          type: 'text/plain',
          partId: '1',
        }
        emailData.bodyValues = {
          '1': {
            value: textBody || '',
            isEncodingProblem: false,
            isTruncated: false,
          },
        }
        emailData.textBody = [{ partId: '1', blobId: null, size: (textBody || '').length }]
      } else if (htmlBody) {
        emailData.bodyStructure = {
          type: 'text/html',
          partId: '1',
        }
        emailData.bodyValues = {
          '1': {
            value: htmlBody,
            isEncodingProblem: false,
            isTruncated: false,
          },
        }
        emailData.htmlBody = [{ partId: '1', blobId: null, size: htmlBody.length }]
      }

      if (inReplyTo) {
        emailData.inReplyTo = [inReplyTo]
        emailData.references = [inReplyTo]
      }

      if (attachments && attachments.length > 0) {
        emailData.attachments = attachments
      }

      // Create and send in one request with proper references
      const result = await jmapClient.request([
        [
          'Email/set',
          {
            accountId,
            create: {
              [tempEmailId]: emailData,
            },
          },
          '0',
        ],
        [
          'EmailSubmission/set',
          {
            accountId,
            create: {
              'submission-1': {
                emailId: `#${tempEmailId}`, // Reference the email created above
                envelope: {
                  mailFrom: { email: session.username },
                  rcptTo: [
                    ...to.map((addr) => ({ email: addr.email })),
                    ...(cc || []).map((addr) => ({ email: addr.email })),
                    ...(bcc || []).map((addr) => ({ email: addr.email })),
                  ],
                },
              },
            },
            onSuccessUpdateEmail: sentMailbox ? {
              [`#${tempEmailId}`]: {
                mailboxIds: { [sentMailbox.id]: true },
                keywords: { 
                  $draft: null,
                  $sent: true,
                  $seen: true 
                }
              }
            } : undefined,
          },
          '1',
        ],
      ])

      console.log('[useSendEmail] Email sent successfully:', result)
      return result
    },
    onSuccess: () => {
      if (accountId) {
        // Refresh emails to show the sent message
        queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
        queryClient.invalidateQueries({ queryKey: ['mailboxes', accountId] })
      }
    },
    onError: (error) => {
      console.error('[useSendEmail] Email send failed:', error.message || 'Unknown error')
    },
  })
}
