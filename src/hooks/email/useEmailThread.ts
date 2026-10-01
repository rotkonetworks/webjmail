import React from 'react'
import { useCacheQuery } from '../useCacheQuery'
import { jmapClient } from '../../api/jmap'
import { usePrimaryAccountId } from '../usePrimaryAccountId'
import { useCurrentUserId } from '../useIndexedDB'
import { db } from '../../db'
import { syncManager } from '../../db/sync'
import type { Email } from '../../api/types'

/**
 * A thread's emails WITH bodies, oldest first — from the local cache (live), so
 * opening a message is instant and works offline. The server is asked only when
 * a member or a body isn't cached yet; its answer is written to the cache and
 * the live query picks it up.
 */
export function useEmailThread(threadId: string | null) {
  const accountId = usePrimaryAccountId()
  const userId = useCurrentUserId()

  const data = useCacheQuery(async (): Promise<Email[] | null> => {
    if (!userId || !threadId) return []
    const headers = await db.messages.where('[_userId+threadId]').equals([userId, threadId]).toArray()
    const bodies = await db.bodies.bulkGet(headers.map((h) => [userId, h.id] as [string, string]))
    // Not fully local yet (no rows, or a body missing) → null = "ask the server".
    if (headers.length === 0 || bodies.some((b) => !b?.bodyValues)) return null
    return headers
      .map((h, i) => ({ ...h, ...bodies[i] }) as Email)
      .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0))
  }, [userId, threadId], null)

  const [fetched, setFetched] = React.useState<{ key: string; emails: Email[] } | null>(null)
  const key = `${userId}|${threadId}`
  React.useEffect(() => {
    if (data !== null || !accountId || !userId || !threadId) return
    let cancelled = false
    jmapClient
      .getEmailThread(accountId, threadId)
      .then(async (emails) => {
        if (cancelled) return
        setFetched({ key, emails })
        await syncManager.storeEmails(emails, userId)
      })
      .catch((e) => {
        if (import.meta.env.DEV) console.error('[useEmailThread] fetch failed:', e)
        if (!cancelled) setFetched({ key, emails: [] })
      })
    return () => {
      cancelled = true
    }
  }, [data, accountId, userId, threadId, key])

  const serverEmails = fetched?.key === key ? fetched.emails : undefined
  return {
    data: data ?? serverEmails ?? [],
    isLoading: data === undefined || (data === null && serverEmails === undefined),
  }
}
