// src/hooks/useJMAP.ts - Fixed real-time updates
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
    staleTime: 30 * 1000, // Reduced to 30 seconds for more frequent updates
    refetchInterval: false, // Disable polling in favor of EventSource
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes('401')) {
        console.error('[useEmails] Got 401, not retrying')
        return false
      }
      return failureCount < 3
    },
  })

  // Simplified EventSource with better error handling and fallback
  React.useEffect(() => {
    if (!accountId || !session || !mailboxId) return

    let eventSource: EventSource | null = null
    let reconnectTimer: NodeJS.Timeout | null = null
    let pollTimer: NodeJS.Timeout | null = null
    let reconnectAttempts = 0
    const maxReconnectAttempts = 3 // Reduced attempts
    const baseReconnectDelay = 2000 // 2 seconds

    // Fallback polling function
    const startFallbackPolling = () => {
      console.log('[EventSource] Starting fallback polling every 30 seconds')
      pollTimer = setInterval(() => {
        console.log('[EventSource] Fallback poll - invalidating queries')
        queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
        queryClient.invalidateQueries({ queryKey: ['mailboxes', accountId] })
      }, 30000) // Poll every 30 seconds
    }

    const connectEventSource = () => {
      try {
        console.log('[EventSource] Attempting to connect... (attempt', reconnectAttempts + 1, ')')
        
        // Try EventSource first
        eventSource = jmapClient.createEventSource(['Email', 'Mailbox'])
        
        let connectionTimeout = setTimeout(() => {
          console.log('[EventSource] Connection timeout - falling back to polling')
          if (eventSource) {
            eventSource.close()
            eventSource = null
          }
          startFallbackPolling()
        }, 5000) // 5 second timeout
        
        eventSource.addEventListener('open', () => {
          console.log('[EventSource] Connection established successfully')
          clearTimeout(connectionTimeout)
          reconnectAttempts = 0 // Reset on successful connection
          
          // Clear any existing polling
          if (pollTimer) {
            clearInterval(pollTimer)
            pollTimer = null
          }
        })

        eventSource.addEventListener('message', (event) => {
          console.log('[EventSource] Received generic message:', event.data)
          // Invalidate queries on any message
          queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
        })
        
        eventSource.addEventListener('state', async (event) => {
          try {
            const data = JSON.parse(event.data)
            console.log('[EventSource] State change received:', data)
            
            if (data.changed?.[accountId]) {
              const changes = data.changed[accountId]
              
              if (changes.Email) {
                console.log('[EventSource] Email state changed, refreshing emails...')
                // Force immediate refetch
                queryClient.invalidateQueries({ 
                  queryKey: ['emails', accountId],
                  refetchType: 'all'
                })
              }
              
              if (changes.Mailbox) {
                console.log('[EventSource] Mailbox state changed, refreshing mailboxes...')
                queryClient.invalidateQueries({ 
                  queryKey: ['mailboxes', accountId],
                  refetchType: 'all' 
                })
              }
            } else {
              // Even if we can't parse the changes, refresh everything
              console.log('[EventSource] Generic state change, refreshing all queries')
              queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
              queryClient.invalidateQueries({ queryKey: ['mailboxes', accountId] })
            }
          } catch (error) {
            console.error('[EventSource] Failed to process state change:', error)
            // Still trigger a refresh even if we can't parse the event
            queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
          }
        })

        eventSource.addEventListener('error', (event) => {
          clearTimeout(connectionTimeout)
          console.error('[EventSource] Connection error occurred')
          console.error('[EventSource] ReadyState:', eventSource?.readyState)
          
          if (eventSource?.readyState === EventSource.CLOSED) {
            console.log('[EventSource] Connection closed, attempting reconnect...')
            
            if (reconnectAttempts < maxReconnectAttempts) {
              reconnectAttempts++
              const delay = baseReconnectDelay * Math.pow(1.5, reconnectAttempts - 1) // Gentler backoff
              
              console.log(`[EventSource] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`)
              
              reconnectTimer = setTimeout(() => {
                if (eventSource) {
                  eventSource.close()
                  eventSource = null
                }
                connectEventSource()
              }, delay)
            } else {
              console.log('[EventSource] Max reconnection attempts reached, using fallback polling')
              startFallbackPolling()
            }
          }
        })

      } catch (error) {
        console.error('[EventSource] Failed to create connection:', error)
        startFallbackPolling()
      }
    }

    // Start with EventSource, fallback to polling if it fails
    connectEventSource()

    // Cleanup function
    return () => {
      console.log('[EventSource] Cleaning up connections...')
      
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      
      if (eventSource) {
        eventSource.close()
        eventSource = null
      }
    }
  }, [accountId, session, mailboxId, queryClient])

  // Force refetch every 2 minutes as additional fallback
  React.useEffect(() => {
    if (!accountId || !mailboxId) return

    const interval = setInterval(() => {
      console.log('[useEmails] Periodic refresh (2 min)')
      query.refetch()
    }, 2 * 60 * 1000) // 2 minutes

    return () => clearInterval(interval)
  }, [accountId, mailboxId, query.refetch])

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
    isFetchingNextPage: query.isFetchingNextPage,
    hasMore,
    total,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  }
}

// Add a manual refresh hook for testing
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
      
      // Also invalidate queries to ensure fresh data
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
        // Force refresh both sent and inbox folders
        queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
        queryClient.invalidateQueries({ queryKey: ['mailboxes', accountId] })
      }
    },
    onError: (error) => {
      console.error('[useSendEmail] Email send failed:', error.message || 'Unknown error')
    },
  })
}
