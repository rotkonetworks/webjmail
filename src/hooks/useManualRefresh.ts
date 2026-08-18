// src/hooks/useManualRefresh.ts
import React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePrimaryAccountId } from './usePrimaryAccountId'

export function useManualRefresh() {
  const queryClient = useQueryClient()
  const accountId = usePrimaryAccountId()

  return React.useCallback(() => {
    console.log('[Manual Refresh] Refreshing all queries')
    
    queryClient.invalidateQueries({ 
      predicate: (query) => {
        const queryKey = query.queryKey
        return Array.isArray(queryKey) && 
               queryKey.length >= 2 && 
               queryKey[1] === accountId
      }
    })
  }, [queryClient, accountId])
}
