import { useQuery } from '@tanstack/react-query'
import { jmapClient } from '../../api/jmap'
import { useAuthStore } from '../../stores/authStore'
import { usePrimaryAccountId } from '../usePrimaryAccountId'

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
