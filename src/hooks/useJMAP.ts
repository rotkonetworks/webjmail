import React from 'react'
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { jmapClient } from '../api/jmap'
import { useAuthStore } from '../stores/authStore'
import { useMailStore } from '../stores/mailStore'

export function usePrimaryAccountId() {
 const session = useAuthStore(s => s.session)
 return session?.primaryAccounts?.['urn:ietf:params:jmap:mail'] || null
}

export function useMailboxes() {
 const session = useAuthStore(s => s.session)
 const accountId = usePrimaryAccountId()
 const setMailboxes = useMailStore(s => s.setMailboxes)

 return useQuery({
   queryKey: ['mailboxes', accountId],
   queryFn: async () => {
     if (!accountId) throw new Error('No account ID')
     const mailboxes = await jmapClient.getMailboxes(accountId)
     setMailboxes(mailboxes)
     return mailboxes
   },
   enabled: !!session && !!accountId,
   staleTime: 5 * 60 * 1000,
 })
}

export function useEmailDetails(emailId: string | null) {
 const accountId = usePrimaryAccountId()
 const session = useAuthStore(s => s.session)
 
 return useQuery({
   queryKey: ['email', accountId, emailId],
   queryFn: async () => {
     if (!accountId || !emailId) return null
     const result = await jmapClient.request([
       ['Email/get', {
         accountId,
         ids: [emailId],
         properties: ['id', 'subject', 'from', 'to', 'cc', 'bcc', 'receivedAt', 
                     'bodyStructure', 'bodyValues', 'keywords', 'mailboxIds'],
         fetchTextBodyValues: true,
         fetchHTMLBodyValues: true,
       }, '0']
     ])
     return result[0][1].list[0]
   },
   enabled: !!session && !!accountId && !!emailId,
 })
}

export function useEmailSearch(query: string, enabled: boolean) {
 const accountId = usePrimaryAccountId()
 const session = useAuthStore(s => s.session)

 return useQuery({
   queryKey: ['search', accountId, query],
   queryFn: async () => {
     if (!accountId || !query.trim()) return []
     return jmapClient.searchEmails(accountId, query)
   },
   enabled: !!session && !!accountId && enabled && query.length > 2,
   staleTime: 30 * 1000,
 })
}

export function useEmails(mailboxId: string | null) {
 const session = useAuthStore(s => s.session)
 const accountId = usePrimaryAccountId()
 const setEmails = useMailStore(s => s.addEmails)
 const [hasMore, setHasMore] = React.useState(true)
 const [total, setTotal] = React.useState(0)

 const query = useInfiniteQuery({
   queryKey: ['emails', accountId, mailboxId],
   queryFn: async ({ pageParam = 0 }) => {
     if (!accountId || !mailboxId) return { emails: [], total: 0, position: 0 }
     return await jmapClient.getEmails(accountId, { inMailbox: mailboxId }, undefined, pageParam, 50)
   },
   getNextPageParam: (lastPage, allPages) => {
     const loaded = allPages.reduce((sum, page) => sum + page.emails.length, 0)
     return loaded >= lastPage.total ? undefined : loaded
   },
   enabled: !!session && !!accountId && !!mailboxId,
   staleTime: 60 * 1000,
 })

 React.useEffect(() => {
   if (query.data) {
     const allEmails = query.data.pages.flatMap(p => p.emails)
     setEmails(allEmails)
     const last = query.data.pages[query.data.pages.length - 1]
     setTotal(last.total)
     setHasMore(query.hasNextPage ?? false)
   }
 }, [query.data, setEmails])

 return {
   emails: query.data?.pages.flatMap(p => p.emails) ?? [],
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
 const session = useAuthStore(s => s.session)

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
 const updateEmail = useMailStore(s => s.updateEmail)

 return useMutation({
   mutationFn: async ({ emailId, isRead }: { emailId: string; isRead: boolean }) => {
     if (!accountId) throw new Error('No account ID')
     return await jmapClient.setEmail(accountId, {
       [emailId]: { keywords: { $seen: isRead } }
     })
   },
   onSuccess: (_, { emailId, isRead }) => {
     updateEmail(emailId, { keywords: { $seen: isRead } })
   },
   onSettled: () => {
     if (accountId) queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
   },
 })
}

export function useMoveEmail() {
 const queryClient = useQueryClient()
 const updateEmail = useMailStore(s => s.updateEmail)

 return useMutation({
   mutationFn: async ({ accountId, emailId, fromMailboxId, toMailboxId }: {
     accountId: string
     emailId: string
     fromMailboxId: string
     toMailboxId: string
   }) => {
     return await jmapClient.setEmail(accountId, {
       [emailId]: {
         mailboxIds: {
           [fromMailboxId]: false,
           [toMailboxId]: true,
         }
       }
     })
   },
   onSuccess: (_, { emailId, fromMailboxId, toMailboxId }) => {
     updateEmail(emailId, {
       mailboxIds: {
         [fromMailboxId]: false,
         [toMailboxId]: true,
       }
     })
   },
   onSettled: (_, __, { accountId }) => {
     queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
   },
 })
}

export function useDeleteEmail() {
 const queryClient = useQueryClient()
 const deleteEmailFromStore = useMailStore(s => s.deleteEmail)

 return useMutation({
   mutationFn: async ({ accountId, emailId }: { accountId: string; emailId: string }) => {
     return await jmapClient.request([
       ['Email/set', { accountId, destroy: [emailId] }, '0']
     ])
   },
   onSuccess: (_, { emailId }) => {
     deleteEmailFromStore(emailId)
   },
   onSettled: (_, __, { accountId }) => {
     queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
   },
 })
}

export function useFlagEmail() {
 const queryClient = useQueryClient()
 const updateEmail = useMailStore(s => s.updateEmail)

 return useMutation({
   mutationFn: async ({ accountId, emailId, isFlagged }: {
     accountId: string
     emailId: string
     isFlagged: boolean
   }) => {
     return await jmapClient.setEmail(accountId, {
       [emailId]: { keywords: { $flagged: isFlagged } }
     })
   },
   onSuccess: (_, { emailId, isFlagged }) => {
     updateEmail(emailId, { keywords: { $flagged: isFlagged } })
   },
   onSettled: (_, __, { accountId }) => {
     queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
   },
 })
}

export function useSendEmail() {
 const queryClient = useQueryClient()
 const accountId = usePrimaryAccountId()
 const session = useAuthStore(s => s.session)
 const mailboxes = useMailStore(s => s.mailboxes)

 return useMutation({
   mutationFn: async ({
     to, cc, bcc, subject, textBody, htmlBody, inReplyTo, attachments
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
     if (!to || to.length === 0) throw new Error('At least one recipient is required')

     const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
     const validateAddrs = (addrs: Array<{ name?: string; email: string }>, field: string) => {
       for (const a of addrs) {
         if (!a.email || !emailRegex.test(a.email)) {
           throw new Error(`Invalid email in ${field}: ${a.email}`)
         }
       }
     }

     validateAddrs(to, 'to')
     if (cc) validateAddrs(cc, 'cc')
     if (bcc) validateAddrs(bcc, 'bcc')

     if (subject && subject.length > 998) throw new Error('Subject too long')
     
     const maxSize = 5 * 1024 * 1024
     if (textBody && textBody.length > maxSize) throw new Error('Text body too large')
     if (htmlBody && htmlBody.length > maxSize) throw new Error('HTML body too large')

     const drafts = Object.values(mailboxes).find(m => m.role === 'drafts')
     const sent = Object.values(mailboxes).find(m => m.role === 'sent')
     const emailId = `email-${Date.now()}`

     const email: any = {
       mailboxIds: {},
       from: [{ name: session.accounts[accountId]?.name || null, email: session.username }],
       to,
       subject: subject || '',
       keywords: { $draft: true, $seen: true },
     }

     if (cc?.length) email.cc = cc
     if (bcc?.length) email.bcc = bcc

     if (textBody) {
       email.bodyStructure = { type: 'text/plain', partId: '1' }
       email.bodyValues = { '1': { value: textBody, isEncodingProblem: false, isTruncated: false } }
       email.textBody = [{ partId: '1' }]
     } else if (htmlBody) {
       email.bodyStructure = { type: 'text/html', partId: '1' }
       email.bodyValues = { '1': { value: htmlBody, isEncodingProblem: false, isTruncated: false } }
       email.htmlBody = [{ partId: '1' }]
     }

     if (inReplyTo) {
       email.inReplyTo = [inReplyTo]
       email.references = [inReplyTo]
     }

     if (attachments?.length) email.attachments = attachments

     return await jmapClient.request([
       ['Email/set', { accountId, create: { [emailId]: email } }, '0'],
       ['EmailSubmission/set', {
         accountId,
         create: {
           [`submission-${Date.now()}`]: {
             emailId: `#${emailId}`,
             envelope: {
               mailFrom: { email: session.username },
               rcptTo: [
                 ...to.map(a => ({ email: a.email })),
                 ...(cc || []).map(a => ({ email: a.email })),
                 ...(bcc || []).map(a => ({ email: a.email })),
               ],
             },
           },
         },
       }, '1'],
     ])
   },
   onSuccess: () => {
     if (accountId) queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
   },
   onError: (error) => {
     console.error('[useSendEmail] Failed:', error.message || 'Unknown error')
   },
 })
}
