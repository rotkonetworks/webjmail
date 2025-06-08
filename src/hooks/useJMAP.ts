import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { jmapClient } from '../api/jmap'
import { useAuthStore } from '../stores/authStore'
import { useMailStore } from '../stores/mailStore'

export function useMailboxes(accountId: string) {
  const setMailboxes = useMailStore((state) => state.setMailboxes)
  
  return useQuery({
    queryKey: ['mailboxes', accountId],
    queryFn: async () => {
      const mailboxes = await jmapClient.getMailboxes(accountId)
      setMailboxes(mailboxes)
      return mailboxes
    },
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useEmails(accountId: string, mailboxId: string | null) {
  const setEmails = useMailStore((state) => state.setEmails)
  
  return useQuery({
    queryKey: ['emails', accountId, mailboxId],
    queryFn: async () => {
      if (!mailboxId) return []
      
      const emails = await jmapClient.getEmails(accountId, {
        inMailbox: mailboxId,
      })
      setEmails(emails)
      return emails
    },
    enabled: !!accountId && !!mailboxId,
    staleTime: 1 * 60 * 1000, // 1 minute
  })
}

export function useMarkAsRead() {
  const queryClient = useQueryClient()
  const updateEmail = useMailStore((state) => state.updateEmail)
  
  return useMutation({
    mutationFn: async ({
      accountId,
      emailId,
      isRead,
    }: {
      accountId: string
      emailId: string
      isRead: boolean
    }) => {
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
    onSettled: (_, __, { accountId }) => {
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    },
  })
}
