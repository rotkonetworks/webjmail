import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { jmapClient } from '../../api/jmap'
import { syncManager } from '../../db/sync'
import { useMailStore } from '../../stores/mailStore'
import { usePrimaryAccountId } from '../usePrimaryAccountId'

// A transform applied to each cached email during an optimistic update. Return a
// modified copy to patch the row, or null to drop it from the list.
type EmailTransform = (email: any) => any | null

// Apply `transform` to every cached ['emails', accountId, *] list immediately so
// the UI reflects the action before the server round-trip completes. Returns a
// snapshot of the affected caches so the change can be rolled back if the
// request fails.
function patchEmailCaches(
  queryClient: QueryClient,
  accountId: string,
  transform: EmailTransform
) {
  const previous = queryClient.getQueriesData({ queryKey: ['emails', accountId] })
  queryClient.setQueriesData({ queryKey: ['emails', accountId] }, (data: any) => {
    if (!data?.pages) return data
    return {
      ...data,
      pages: data.pages.map((page: any) => {
        if (!Array.isArray(page?.emails)) return page
        let removed = 0
        const emails = page.emails
          .map((e: any) => {
            const next = transform(e)
            if (next === null) removed++
            return next
          })
          .filter((e: any) => e !== null)
        return { ...page, emails, total: Math.max(0, (page.total ?? 0) - removed) }
      }),
    }
  })
  return previous
}

function restoreEmailCaches(
  queryClient: QueryClient,
  previous: ReturnType<QueryClient['getQueriesData']> | undefined
) {
  previous?.forEach(([key, data]) => queryClient.setQueryData(key, data))
}

const setKeyword =
  (id: string, key: '$seen' | '$flagged', value: boolean): EmailTransform =>
  (e) =>
    e.id === id ? { ...e, keywords: { ...e.keywords, [key]: value } } : e

export function useMarkAsRead() {
  const queryClient = useQueryClient()
  const accountId = usePrimaryAccountId()
  const updateEmail = useMailStore((state) => state.updateEmail)

  return useMutation({
    mutationFn: async ({ emailId, isRead }: { emailId: string; isRead: boolean }) => {
      if (!accountId) throw new Error('No account ID')
      const result = await jmapClient.setEmail(accountId, {
        [emailId]: { keywords: { $seen: isRead } },
      })
      await syncManager.patchCachedKeywords([emailId], { $seen: isRead })
      return result
    },
    // Optimistic: flip the row's read state now; the server call catches up.
    onMutate: async ({ emailId, isRead }) => {
      if (!accountId) return {}
      await queryClient.cancelQueries({ queryKey: ['emails', accountId] })
      const previous = patchEmailCaches(queryClient, accountId, setKeyword(emailId, '$seen', isRead))
      updateEmail(emailId, { keywords: { $seen: isRead } as any })
      return { previous }
    },
    onError: (_err, _vars, ctx) => restoreEmailCaches(queryClient, (ctx as any)?.previous),
    onSettled: () => {
      if (accountId) queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    },
  })
}

export function useFlagEmail() {
  const queryClient = useQueryClient()
  const updateEmail = useMailStore((state) => state.updateEmail)

  return useMutation({
    mutationFn: async ({
      accountId,
      emailId,
      isFlagged,
    }: {
      accountId: string
      emailId: string
      isFlagged: boolean
    }) => {
      const result = await jmapClient.setEmail(accountId, {
        [emailId]: { keywords: { $flagged: isFlagged } },
      })
      await syncManager.patchCachedKeywords([emailId], { $flagged: isFlagged })
      return result
    },
    onMutate: async ({ accountId, emailId, isFlagged }) => {
      await queryClient.cancelQueries({ queryKey: ['emails', accountId] })
      const previous = patchEmailCaches(
        queryClient,
        accountId,
        setKeyword(emailId, '$flagged', isFlagged)
      )
      updateEmail(emailId, { keywords: { $flagged: isFlagged } as any })
      return { previous }
    },
    onError: (_err, _vars, ctx) => restoreEmailCaches(queryClient, (ctx as any)?.previous),
    onSettled: (_data, _err, { accountId }) =>
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] }),
  })
}

/**
 * Bulk actions over a set of email ids (multi-select). Each is a single JMAP
 * Email/set call, applied optimistically (the list updates on click) and rolled
 * back if the request fails.
 */
export function useBulkEmailActions() {
  const queryClient = useQueryClient()
  const accountId = usePrimaryAccountId()
  const updateEmail = useMailStore((state) => state.updateEmail)
  const deleteEmailFromStore = useMailStore((state) => state.deleteEmail)

  const markSeen = async (ids: string[], isRead: boolean) => {
    if (!accountId || ids.length === 0) return
    const set = new Set(ids)
    await queryClient.cancelQueries({ queryKey: ['emails', accountId] })
    const previous = patchEmailCaches(queryClient, accountId, (e) =>
      set.has(e.id) ? { ...e, keywords: { ...e.keywords, $seen: isRead } } : e
    )
    ids.forEach((id) => updateEmail(id, { keywords: { $seen: isRead } as any }))
    try {
      const update: Record<string, any> = {}
      ids.forEach((id) => {
        update[id] = { 'keywords/$seen': isRead }
      })
      await jmapClient.setEmail(accountId, update)
      await syncManager.patchCachedKeywords(ids, { $seen: isRead })
    } catch (err) {
      restoreEmailCaches(queryClient, previous)
      throw err
    } finally {
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    }
  }

  const remove = async (ids: string[]) => {
    if (!accountId || ids.length === 0) return
    const set = new Set(ids)
    await queryClient.cancelQueries({ queryKey: ['emails', accountId] })
    const previous = patchEmailCaches(queryClient, accountId, (e) => (set.has(e.id) ? null : e))
    ids.forEach((id) => deleteEmailFromStore(id))
    try {
      await jmapClient.request([['Email/set', { accountId, destroy: ids }, '0']])
      await syncManager.removeCachedEmails(ids)
    } catch (err) {
      restoreEmailCaches(queryClient, previous)
      throw err
    } finally {
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    }
  }

  // Move to a folder = replace the email's mailbox membership with the target.
  const move = async (ids: string[], mailboxId: string) => {
    if (!accountId || ids.length === 0) return
    const set = new Set(ids)
    await queryClient.cancelQueries({ queryKey: ['emails', accountId] })
    // Drop the moved rows from the current (source) view immediately.
    const previous = patchEmailCaches(queryClient, accountId, (e) => (set.has(e.id) ? null : e))
    try {
      const update: Record<string, any> = {}
      ids.forEach((id) => {
        update[id] = { mailboxIds: { [mailboxId]: true } }
      })
      await jmapClient.setEmail(accountId, update)
      await syncManager.setCachedMailbox(ids, mailboxId)
    } catch (err) {
      restoreEmailCaches(queryClient, previous)
      throw err
    } finally {
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
      queryClient.invalidateQueries({ queryKey: ['mailboxes', accountId] })
    }
  }

  // Rescue mail from Junk: move it to the inbox and set $notjunk / clear $junk so
  // Stalwart's spam filter learns this sender is good (less likely to re-junk).
  const notJunk = async (ids: string[], inboxId: string) => {
    if (!accountId || ids.length === 0 || !inboxId) return
    const set = new Set(ids)
    await queryClient.cancelQueries({ queryKey: ['emails', accountId] })
    const previous = patchEmailCaches(queryClient, accountId, (e) => (set.has(e.id) ? null : e))
    try {
      const update: Record<string, any> = {}
      ids.forEach((id) => {
        update[id] = {
          mailboxIds: { [inboxId]: true },
          'keywords/$notjunk': true,
          'keywords/$junk': null,
        }
      })
      await jmapClient.setEmail(accountId, update)
      await syncManager.setCachedMailbox(ids, inboxId)
    } catch (err) {
      restoreEmailCaches(queryClient, previous)
      throw err
    } finally {
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
      queryClient.invalidateQueries({ queryKey: ['mailboxes', accountId] })
    }
  }

  // Report as junk: move to the Junk folder and set $junk / clear $notjunk so
  // Stalwart's filter learns to catch this sender.
  const junk = async (ids: string[], junkId: string) => {
    if (!accountId || ids.length === 0 || !junkId) return
    const set = new Set(ids)
    await queryClient.cancelQueries({ queryKey: ['emails', accountId] })
    const previous = patchEmailCaches(queryClient, accountId, (e) => (set.has(e.id) ? null : e))
    try {
      const update: Record<string, any> = {}
      ids.forEach((id) => {
        update[id] = {
          mailboxIds: { [junkId]: true },
          'keywords/$junk': true,
          'keywords/$notjunk': null,
        }
      })
      await jmapClient.setEmail(accountId, update)
      await syncManager.setCachedMailbox(ids, junkId)
    } catch (err) {
      restoreEmailCaches(queryClient, previous)
      throw err
    } finally {
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
      queryClient.invalidateQueries({ queryKey: ['mailboxes', accountId] })
    }
  }

  return { markSeen, remove, move, notJunk, junk }
}

export function useDeleteEmail() {
  const queryClient = useQueryClient()
  const deleteEmailFromStore = useMailStore((state) => state.deleteEmail)

  return useMutation({
    mutationFn: async ({ accountId, emailId }: { accountId: string; emailId: string }) => {
      const result = await jmapClient.request([
        ['Email/set', { accountId, destroy: [emailId] }, '0'],
      ])
      await syncManager.removeCachedEmails([emailId])
      return result
    },
    // Optimistic: the row disappears immediately; restored if the delete fails.
    onMutate: async ({ accountId, emailId }) => {
      await queryClient.cancelQueries({ queryKey: ['emails', accountId] })
      const previous = patchEmailCaches(queryClient, accountId, (e) => (e.id === emailId ? null : e))
      deleteEmailFromStore(emailId)
      return { previous }
    },
    onError: (_err, _vars, ctx) => restoreEmailCaches(queryClient, (ctx as any)?.previous),
    onSettled: (_data, _err, { accountId }) =>
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] }),
  })
}
