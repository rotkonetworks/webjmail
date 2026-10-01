import { useMutation } from '@tanstack/react-query'
import { jmapClient } from '../../api/jmap'
import { syncManager } from '../../db/sync'
import { useMailStore } from '../../stores/mailStore'
import { usePrimaryAccountId } from '../usePrimaryAccountId'

// Every action is optimistic against the LOCAL CACHE: the rows are patched in
// IndexedDB first (the live-query lists update on the spot), then the server is
// told. If the server rejects it, the snapshot taken beforehand is restored —
// no server change event will arrive to correct a rejected set.
async function optimistic(ids: string[], apply: () => Promise<void>, send: () => Promise<unknown>) {
  const snap = await syncManager.snapshot(ids)
  await apply()
  try {
    await send()
  } catch (err) {
    await syncManager.restore(snap)
    throw err
  }
}

export function useMarkAsRead() {
  const accountId = usePrimaryAccountId()
  const updateEmail = useMailStore((state) => state.updateEmail)

  return useMutation({
    mutationFn: async ({ emailId, isRead }: { emailId: string; isRead: boolean }) => {
      if (!accountId) throw new Error('No account ID')
      updateEmail(emailId, { keywords: { $seen: isRead } as any })
      await optimistic(
        [emailId],
        () => syncManager.patchCachedKeywords([emailId], { $seen: isRead }),
        () => jmapClient.setEmail(accountId, { [emailId]: { 'keywords/$seen': isRead || null } as any })
      ).catch((err) => {
        updateEmail(emailId, { keywords: { $seen: !isRead } as any })
        throw err
      })
    },
  })
}

export function useFlagEmail() {
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
      updateEmail(emailId, { keywords: { $flagged: isFlagged } as any })
      await optimistic(
        [emailId],
        () => syncManager.patchCachedKeywords([emailId], { $flagged: isFlagged }),
        () =>
          jmapClient.setEmail(accountId, { [emailId]: { 'keywords/$flagged': isFlagged || null } as any })
      ).catch((err) => {
        updateEmail(emailId, { keywords: { $flagged: !isFlagged } as any })
        throw err
      })
    },
  })
}

/**
 * Bulk actions over a set of email ids (multi-select). Each is a single JMAP
 * Email/set call, applied optimistically to the cache and rolled back if the
 * request fails.
 */
export function useBulkEmailActions() {
  const accountId = usePrimaryAccountId()
  const updateEmail = useMailStore((state) => state.updateEmail)
  const deleteEmailFromStore = useMailStore((state) => state.deleteEmail)

  const markSeen = async (ids: string[], isRead: boolean) => {
    if (!accountId || ids.length === 0) return
    ids.forEach((id) => updateEmail(id, { keywords: { $seen: isRead } as any }))
    const update: Record<string, any> = {}
    ids.forEach((id) => {
      update[id] = { 'keywords/$seen': isRead || null }
    })
    await optimistic(
      ids,
      () => syncManager.patchCachedKeywords(ids, { $seen: isRead }),
      () => jmapClient.setEmail(accountId, update)
    )
  }

  const remove = async (ids: string[]) => {
    if (!accountId || ids.length === 0) return
    ids.forEach((id) => deleteEmailFromStore(id))
    await optimistic(
      ids,
      () => syncManager.removeCachedEmails(ids),
      () => jmapClient.request([['Email/set', { accountId, destroy: ids }, '0']])
    )
  }

  // Move to a folder = replace the email's mailbox membership with the target,
  // optionally setting/clearing keywords in the same Email/set (junk training).
  const moveWith = async (ids: string[], mailboxId: string, keywords: Record<string, boolean | null> = {}) => {
    if (!accountId || ids.length === 0 || !mailboxId) return
    const update: Record<string, any> = {}
    ids.forEach((id) => {
      update[id] = { mailboxIds: { [mailboxId]: true } }
      for (const [k, v] of Object.entries(keywords)) update[id][`keywords/${k}`] = v
    })
    await optimistic(
      ids,
      async () => {
        await syncManager.setCachedMailbox(ids, mailboxId)
        if (Object.keys(keywords).length) await syncManager.patchCachedKeywords(ids, keywords)
      },
      () => jmapClient.setEmail(accountId, update)
    )
  }

  const move = (ids: string[], mailboxId: string) => moveWith(ids, mailboxId)

  // Rescue mail from Junk: move it to the inbox and set $notjunk / clear $junk so
  // Stalwart's spam filter learns this sender is good (less likely to re-junk).
  const notJunk = (ids: string[], inboxId: string) =>
    moveWith(ids, inboxId, { $notjunk: true, $junk: null })

  // Report as junk: move to the Junk folder and set $junk / clear $notjunk so
  // Stalwart's filter learns to catch this sender.
  const junk = (ids: string[], junkId: string) =>
    moveWith(ids, junkId, { $junk: true, $notjunk: null })

  return { markSeen, remove, move, notJunk, junk }
}

export function useDeleteEmail() {
  const deleteEmailFromStore = useMailStore((state) => state.deleteEmail)

  return useMutation({
    mutationFn: async ({ accountId, emailId }: { accountId: string; emailId: string }) => {
      deleteEmailFromStore(emailId)
      await optimistic(
        [emailId],
        () => syncManager.removeCachedEmails([emailId]),
        () => jmapClient.request([['Email/set', { accountId, destroy: [emailId] }, '0']])
      )
    },
  })
}
