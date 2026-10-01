import React from 'react'
import { useCacheQuery } from '../useCacheQuery'
import { useSyncStatusStore } from '../../stores/syncStatusStore'
import { useMailStore } from '../../stores/mailStore'
import { usePrimaryAccountId } from '../usePrimaryAccountId'
import { useCurrentUserId } from '../useIndexedDB'
import { db, mailboxSortRange, type CachedEmail } from '../../db'
import type { Email } from '../../api/types'
import { syncManager } from '../../db/sync'

const PAGE_SIZE = 50

/**
 * Local-first, reactive mailbox list.
 *
 * Renders a live query over the IndexedDB mirror: whenever the delta sync (or an
 * optimistic action) writes a row in this range, the list updates by itself —
 * there's no refetch/invalidate step. The server is only touched here when the
 * cache doesn't reach far enough yet (first run before the reconcile finishes,
 * or scrolling past what's cached).
 */
export function useEmails(mailboxId: string | null) {
  const accountId = usePrimaryAccountId()
  const userId = useCurrentUserId()
  const addEmails = useMailStore((state) => state.addEmails)
  const [limit, setLimit] = React.useState(PAGE_SIZE)
  const [fetching, setFetching] = React.useState(false)

  React.useEffect(() => setLimit(PAGE_SIZE), [mailboxId, userId])

  const emails = useCacheQuery(
    () =>
      userId && mailboxId
        ? db.messages
            .where('_mbSort')
            .between(...mailboxSortRange(userId, mailboxId))
            .reverse()
            .limit(limit)
            .toArray()
        : ([] as CachedEmail[]),
    [userId, mailboxId, limit],
    [] as CachedEmail[]
  )

  // Server-side total comes from the (synced) mailbox row.
  const mailbox = useCacheQuery(
    () => (userId && mailboxId ? db.folders.get([userId, mailboxId]) : undefined),
    [userId, mailboxId],
    undefined
  )
  // While the reconcile is downloading, it fills the cache itself (newest
  // first) — don't race it with page fetches of the same emails.
  const indexing = useSyncStatusStore((s) => s.indexing)
  const loaded = emails?.length ?? 0
  const total = Math.max(mailbox?.totalEmails ?? 0, loaded)

  // Fill from the server when the cache is short of what the view wants.
  // Last server page, shown only if the cache yields nothing (cache disabled
  // after a storage fault) so the list still works without IndexedDB.
  const [serverPage, setServerPage] = React.useState<{ key: string; emails: Email[] } | null>(null)
  const viewKey = `${userId}|${mailboxId}`

  const attempted = React.useRef(new Set<string>())
  React.useEffect(() => {
    if (!emails || !accountId || !userId || !mailboxId || fetching) return
    // First page always (instant first paint); later pages wait for the reconcile.
    if (indexing && loaded > 0) return
    const want = Math.min(limit, mailbox?.totalEmails ?? limit)
    if (loaded >= want) return
    const key = `${userId}|${mailboxId}|${loaded}`
    if (attempted.current.has(key)) return
    attempted.current.add(key)
    setFetching(true)
    syncManager
      .fetchAndCacheEmails(accountId, userId, mailboxId, loaded, limit - loaded)
      .then((r) => {
        if (loaded === 0) setServerPage({ key: `${userId}|${mailboxId}`, emails: r.emails })
      })
      .catch((e) => {
        if (import.meta.env.DEV) console.error('[useEmails] fill failed:', e)
      })
      .finally(() => setFetching(false))
  }, [emails, loaded, limit, mailbox?.totalEmails, accountId, userId, mailboxId, fetching, indexing])

  const shown: Email[] | undefined =
    emails && emails.length === 0 && serverPage?.key === viewKey ? serverPage.emails : emails

  // Mirror into mailStore (the reader and composers look emails up there).
  React.useEffect(() => {
    if (shown && shown.length > 0) addEmails(shown)
  }, [shown, addEmails])

  const fetchNextPage = React.useCallback(() => setLimit((l) => l + PAGE_SIZE), [])
  const refetch = React.useCallback(() => syncManager.syncNow(), [])

  return {
    emails: shown ?? [],
    isLoading: emails === undefined || (loaded === 0 && fetching),
    isFetching: fetching,
    isFetchingNextPage: fetching && loaded > 0,
    hasMore: loaded < total,
    total,
    fetchNextPage,
    // Refresh button → a delta sync with the server.
    refetch,
  }
}
