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

      // Validate input parameters
      if (!to || to.length === 0) {
        throw new Error('At least one recipient is required')
      }
      
      // Validate email addresses
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      const validateEmailAddresses = (addresses: Array<{ name?: string; email: string }>, fieldName: string) => {
        for (const addr of addresses) {
          if (!addr.email || !emailRegex.test(addr.email)) {
            throw new Error(`Invalid email address in ${fieldName}: ${addr.email}`)
          }
        }
      }
      
      validateEmailAddresses(to, 'to')
      if (cc) validateEmailAddresses(cc, 'cc')
      if (bcc) validateEmailAddresses(bcc, 'bcc')
      
      // Validate subject length
      if (subject && subject.length > 998) {
        throw new Error('Subject line too long (max 998 characters)')
      }
      
      // Validate body content size (prevent DoS)
      const maxBodySize = 1024 * 1024 * 5 // 5MB limit
      if (textBody && textBody.length > maxBodySize) {
        throw new Error('Text body too large')
      }
      if (htmlBody && htmlBody.length > maxBodySize) {
        throw new Error('HTML body too large')
      }

      // Find drafts and sent mailboxes
      const draftsMailbox = Object.values(mailboxes).find(m => m.role === 'drafts')
      const sentMailbox = Object.values(mailboxes).find(m => m.role === 'sent')

      const emailId = `email-${Date.now()}`
      
      // Create a simplified email structure for better compatibility
      const emailData: any = {
        mailboxIds: {},
        from: [{ 
          name: session.accounts[accountId]?.name || null,
          email: session.username 
        }],
        to,
        subject: subject || '',
        keywords: {
          $draft: true,
          $seen: true,
        },
      }

      // Add CC and BCC if present
      if (cc && cc.length > 0) {
        emailData.cc = cc
      }
      if (bcc && bcc.length > 0) {
        emailData.bcc = bcc
      }

      // Handle body content - prefer text body for simplicity
      if (textBody) {
        emailData.bodyStructure = {
          type: 'text/plain',
          partId: '1',
        }
        emailData.bodyValues = {
          '1': { 
            value: textBody,
            isEncodingProblem: false,
            isTruncated: false
          }
        }
        emailData.textBody = [{ partId: '1' }]
      } else if (htmlBody) {
        emailData.bodyStructure = {
          type: 'text/html', 
          partId: '1',
        }
        emailData.bodyValues = {
          '1': { 
            value: htmlBody,
            isEncodingProblem: false,
            isTruncated: false
          }
        }
        emailData.htmlBody = [{ partId: '1' }]
      }

      // Add reply headers if this is a reply
      if (inReplyTo) {
        emailData.inReplyTo = [inReplyTo]
        emailData.references = [inReplyTo]
      }

      // Add attachments if present
      if (attachments && attachments.length > 0) {
        emailData.attachments = attachments
      }


      const result = await jmapClient.request([
        // Create the email
        ['Email/set', {
          accountId,
          create: {
            [emailId]: emailData
          },
        }, '0'],
        // Submit the email for sending
        ['EmailSubmission/set', {
          accountId,
          create: {
            [`submission-${Date.now()}`]: {
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
            [`#${emailId}`]: {
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
    onError: (error) => {
      // Log error without exposing sensitive data
      console.error('[useSendEmail] Email send failed:', error.message || 'Unknown error')
    },
  })
}
