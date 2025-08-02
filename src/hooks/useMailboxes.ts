import { useQuery } from '@tanstack/react-query'
import { jmapClient } from '../api/jmap'
import { useAuthStore } from '../stores/authStore'
import { useMailStore } from '../stores/mailStore'
import { usePrimaryAccountId } from './usePrimaryAccountId'

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
