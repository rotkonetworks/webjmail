// src/hooks/useJMAP.ts - Fixed EventSource handling
import React from 'react'
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { jmapClient } from '../api/jmap'
import { useAuthStore } from '../stores/authStore'
import { useMailStore } from '../stores/mailStore'

export function usePrimaryAccountId() {
  const session = useAuthStore((state) => state.session)
  const accountId = session?.primaryAccounts?.['urn:ietf:params:jmap:mail'] || null
  
  console.log('[useJMAP] Primary account ID:', accountId)
  
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
      
      console.log('[useMailboxes] Fetching mailboxes for account:', accountId)
      
      const mailboxes = await jmapClient.getMailboxes(accountId)
      setMailboxes(mailboxes)
      
      console.log('[useMailboxes] Fetched mailboxes:', mailboxes.length)
      
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

      console.log('[useEmails] Fetching emails at position:', pageParam)
      
      const result = await jmapClient.getEmails(
        accountId,
        { inMailbox: mailboxId },
        undefined,
        pageParam,
        50
      )

      console.log('[useEmails] Fetched:', result.emails.length, 'emails, total:', result.total)
      
      return result
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.emails.length, 0)
      console.log('[useEmails] Loaded:', loadedCount, 'of', lastPage.total)
      
      if (loadedCount >= lastPage.total) {
        return undefined
      }
      
      return loadedCount
    },
    enabled: !!session && !!accountId && !!mailboxId,
    staleTime: 1 * 60 * 1000,
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: true,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes('401')) {
        console.error('[useEmails] Got 401, not retrying')
        return false
      }
      return failureCount < 3
    },
  })

  // Enhanced EventSource setup with proper error handling
  React.useEffect(() => {
    if (!accountId || !session || !mailboxId) return

    let eventSource: EventSource | null = null
    let reconnectTimer: NodeJS.Timeout | null = null
    let reconnectAttempts = 0
    const maxReconnectAttempts = 5
    const baseReconnectDelay = 1000 // Start with 1 second

    const connectEventSource = () => {
      try {
        console.log('[EventSource] Attempting to connect... (attempt', reconnectAttempts + 1, ')')
        
        eventSource = jmapClient.createEventSource(['Email', 'Mailbox'])
        
        eventSource.addEventListener('open', () => {
          console.log('[EventSource] Connection established successfully')
          reconnectAttempts = 0 // Reset on successful connection
        })

        eventSource.addEventListener('message', (event) => {
          console.log('[EventSource] Received generic message:', event.data)
        })
        
        eventSource.addEventListener('state', async (event) => {
          try {
            const data = JSON.parse(event.data)
            console.log('[EventSource] State change received:', data)
            
            if (data.changed?.[accountId]) {
              const changes = data.changed[accountId]
              
              if (changes.Email) {
                console.log('[EventSource] Email state changed, invalidating queries...')
                // Invalidate all email queries for this account
                queryClient.invalidateQueries({ 
                  queryKey: ['emails', accountId] 
                })
              }
              
              if (changes.Mailbox) {
                console.log('[EventSource] Mailbox state changed, invalidating mailbox queries...')
                queryClient.invalidateQueries({ 
                  queryKey: ['mailboxes', accountId] 
                })
              }
            }
          } catch (error) {
            console.error('[EventSource] Failed to process state change:', error)
          }
        })

        eventSource.addEventListener('error', (event) => {
          console.error('[EventSource] Connection error occurred')
          console.error('[EventSource] ReadyState:', eventSource?.readyState)
          
          if (eventSource?.readyState === EventSource.CLOSED) {
            console.log('[EventSource] Connection closed, attempting reconnect...')
            
            if (reconnectAttempts < maxReconnectAttempts) {
              reconnectAttempts++
              const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts - 1) // Exponential backoff
              
              console.log(`[EventSource] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`)
              
              reconnectTimer = setTimeout(() => {
                if (eventSource) {
                  eventSource.close()
                  eventSource = null
                }
                connectEventSource()
              }, delay)
            } else {
              console.error('[EventSource] Max reconnection attempts reached, giving up')
            }
          }
        })

      } catch (error) {
        console.error('[EventSource] Failed to create connection:', error)
        
        // Retry with exponential backoff
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++
          const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts - 1)
          
          console.log(`[EventSource] Retrying connection in ${delay}ms`)
          reconnectTimer = setTimeout(connectEventSource, delay)
        }
      }
    }

    // Initial connection
    connectEventSource()

    // Cleanup function
    return () => {
      console.log('[EventSource] Cleaning up connections...')
      
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      
      if (eventSource) {
        eventSource.close()
        eventSource = null
      }
    }
  }, [accountId, session, mailboxId, queryClient])

  // Update store when data changes
  React.useEffect(() => {
    if (query.data) {
      const allEmails = query.data.pages.flatMap((page) => page.emails)
      setEmails(allEmails)
    }
  }, [query.data, setEmails])

  // Calculate derived state
  const emails = query.data?.pages.flatMap((page) => page.emails) ?? []
  const total = query.data?.pages[0]?.total ?? 0
  const hasMore = query.hasNextPage ?? false

  return {
    emails,
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
    },
    onSettled: () => {
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
    onSuccess: (_, { emailId }) => {
      deleteEmailFromStore(emailId)
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

      const emailId = `email-${Date.now()}`

      const emailData: any = {
        mailboxIds: {},
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
      }

      if (cc && cc.length > 0) emailData.cc = cc
      if (bcc && bcc.length > 0) emailData.bcc = bcc

      if (textBody) {
        emailData.bodyStructure = {
          type: 'text/plain',
          partId: '1',
        }
        emailData.bodyValues = {
          '1': {
            value: textBody,
            isEncodingProblem: false,
            isTruncated: false,
          },
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
            isTruncated: false,
          },
        }
        emailData.htmlBody = [{ partId: '1' }]
      }

      if (inReplyTo) {
        emailData.inReplyTo = [inReplyTo]
        emailData.references = [inReplyTo]
      }

      if (attachments && attachments.length > 0) {
        emailData.attachments = attachments
      }

      const result = await jmapClient.request([
        [
          'Email/set',
          {
            accountId,
            create: {
              [emailId]: emailData,
            },
          },
          '0',
        ],
        [
          'EmailSubmission/set',
          {
            accountId,
            create: {
              [`submission-${Date.now()}`]: {
                emailId: `#${emailId}`,
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
          },
          '1',
        ],
      ])

      console.log('[useSendEmail] Email sent successfully')
      return result
    },
    onSuccess: () => {
      if (accountId) {
        queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
      }
    },
    onError: (error) => {
      console.error('[useSendEmail] Email send failed:', error.message || 'Unknown error')
    },
  })
}
