import { useQuery } from '@tanstack/react-query'
import { jmapClient } from '../../api/jmap'
import { useAuthStore } from '../../stores/authStore'
import { usePrimaryAccountId } from '../usePrimaryAccountId'

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
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnMount: false, // Don't refetch if we already have data
    refetchOnWindowFocus: false, // Don't refetch on window focus
  })
}
