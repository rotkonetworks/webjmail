import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

export function useEmails(mailboxId: string | null) {
  const session = useAuthStore((state) => state.session)
  const accountId = usePrimaryAccountId()
  const setEmails = useMailStore((state) => state.setEmails)

  return useQuery({
    queryKey: ['emails', accountId, mailboxId],
    queryFn: async () => {
      if (!accountId || !mailboxId) return []

      const emails = await jmapClient.getEmails(accountId, {
        inMailbox: mailboxId,
      })
      setEmails(emails)
      return emails
    },
    enabled: !!session && !!accountId && !!mailboxId,
    staleTime: 1 * 60 * 1000, // 1 minute
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
