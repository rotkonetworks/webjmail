import React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePrimaryAccountId } from './usePrimaryAccountId'

export function useManualRefresh() {
  const queryClient = useQueryClient()
  const accountId = usePrimaryAccountId()

  return React.useCallback(() => {
    console.log('[Manual Refresh] Refreshing all queries')
    queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    queryClient.invalidateQueries({ queryKey: ['mailboxes', accountId] })
  }, [queryClient, accountId])
}
