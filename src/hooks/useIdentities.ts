import { useQuery } from '@tanstack/react-query'
import { jmapClient } from '../api/jmap'
import { useAuthStore } from '../stores/authStore'
import { usePrimaryAccountId } from './usePrimaryAccountId'
import type { Identity } from '../api/types'

export function useIdentities() {
  const accountId = usePrimaryAccountId()
  const session = useAuthStore((state) => state.session)

  return useQuery({
    queryKey: ['identities', accountId],
    queryFn: async (): Promise<Identity[]> => {
      if (!accountId || !session) {
        throw new Error('No account ID or session')
      }

      console.log('[useIdentities] Fetching identities for account:', accountId)

      const response = await jmapClient.request([
        [
          'Identity/get',
          {
            accountId,
            properties: null, // Get all properties
          },
          'getIdentities'
        ]
      ])

      const [, result] = response[0]
      const identities = result.list || []

      console.log('[useIdentities] Found identities:', identities.length)

      // Sort identities to put the primary one first
      const sortedIdentities = identities.sort((a: Identity, b: Identity) => {
        // Put the identity matching the session username first
        if (a.email === session.username) return -1
        if (b.email === session.username) return 1

        // Then sort by name/email
        return (a.name || a.email).localeCompare(b.name || b.email)
      })

      return sortedIdentities
    },
    enabled: !!accountId && !!session,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  })
}

export function useDefaultIdentity() {
  const { data: identities, ...rest } = useIdentities()
  const session = useAuthStore((state) => state.session)

  const defaultIdentity = identities?.[0] || (session ? {
    id: 'default',
    name: '',
    email: session.username,
    mayDelete: false,
  } as Identity : null)

  return {
    data: defaultIdentity,
    identities,
    ...rest,
  }
}