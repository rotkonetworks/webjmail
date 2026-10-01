import React from 'react'
import { useCacheQuery } from './useCacheQuery'
import { useMailStore } from '../stores/mailStore'
import { usePrimaryAccountId } from './usePrimaryAccountId'
import { useCurrentUserId } from './useIndexedDB'
import { db } from '../db'
import { syncManager } from '../db/sync'
import type { Mailbox } from '../api/types'

/**
 * Local-first, reactive folder list: a live query over the cached mailboxes,
 * kept current by the delta sync (which replaces them whenever the server's
 * Mailbox state moves — e.g. unread counts). Fetched directly only when the
 * cache has none yet.
 */
export function useMailboxes() {
  const accountId = usePrimaryAccountId()
  const userId = useCurrentUserId()
  const setMailboxes = useMailStore((state) => state.setMailboxes)
  const [error, setError] = React.useState<unknown>(null)

  const data = useCacheQuery(
    async (): Promise<Mailbox[]> => {
      if (!userId) return []
      const rows = await db.folders.where('_userId').equals(userId).toArray()
      return rows.map(({ _userId, ...mb }) => mb)
    },
    [userId],
    [] as Mailbox[]
  )

  // Last server fetch, shown only if the cache yields nothing (cache disabled
  // after a storage fault).
  const [fetched, setFetched] = React.useState<{ userId: string; list: Mailbox[] } | null>(null)

  const refetch = React.useCallback(async () => {
    if (!accountId || !userId) return
    try {
      const list = await syncManager.fetchAndCacheMailboxes(accountId, userId)
      setFetched({ userId, list })
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [accountId, userId])

  // Cold cache (first run) → fetch now rather than wait for the reconcile.
  React.useEffect(() => {
    if (data && data.length === 0) void refetch()
  }, [data, refetch])

  const shown = data && data.length === 0 && fetched?.userId === userId ? fetched.list : data

  React.useEffect(() => {
    if (shown && shown.length > 0) setMailboxes(shown)
  }, [shown, setMailboxes])

  return {
    data: shown,
    isLoading: shown === undefined || (shown.length === 0 && !error),
    error: shown && shown.length > 0 ? null : error,
    refetch,
  }
}
