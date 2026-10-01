// src/hooks/useManualRefresh.ts
import React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePrimaryAccountId } from './usePrimaryAccountId'
import { syncManager } from '../db/sync'

export function useManualRefresh() {
  const queryClient = useQueryClient()
  const accountId = usePrimaryAccountId()

  return React.useCallback(async () => {
    // Mail lives in the local mirror → a delta sync refreshes every list.
    // Other server-backed queries (calendar, identities, …) are refetched.
    queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey
        return Array.isArray(queryKey) && queryKey.length >= 2 && queryKey[1] === accountId
      },
    })
    await syncManager.syncNow()
  }, [queryClient, accountId])
}
