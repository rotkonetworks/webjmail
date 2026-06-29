import { useMutation, useQueryClient } from '@tanstack/react-query'
import { jmapClient } from '../../api/jmap'
import { syncManager } from '../../db/sync'
import { useMailStore } from '../../stores/mailStore'
import { usePrimaryAccountId } from '../usePrimaryAccountId'

export function useMarkAsRead() {
  const queryClient = useQueryClient()
  const accountId = usePrimaryAccountId()
  const updateEmail = useMailStore((state) => state.updateEmail)

  return useMutation({
    mutationFn: async ({ emailId, isRead }: { emailId: string; isRead: boolean }) => {
      if (!accountId) throw new Error('No account ID')

      const update = {
        [emailId]: {
          keywords: {
            $seen: isRead,
          },
        },
      }

      const result = await jmapClient.setEmail(accountId, update)
      await syncManager.patchCachedKeywords([emailId], { $seen: isRead })
      return result
    },
    onSuccess: (_, { emailId, isRead }) => {
      updateEmail(emailId, {
        keywords: { $seen: isRead },
      })
      
      if (accountId) {
        queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
      }
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
      const update = {
        [emailId]: {
          keywords: {
            $flagged: isFlagged,
          },
        },
      }

      const result = await jmapClient.setEmail(accountId, update)
      await syncManager.patchCachedKeywords([emailId], { $flagged: isFlagged })
      return result
    },
    onSuccess: (_, { emailId, isFlagged, accountId }) => {
      updateEmail(emailId, {
        keywords: { $flagged: isFlagged },
      })
      
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    },
  })
}

/**
 * Bulk actions over a set of email ids (multi-select). Each operation is a single
 * JMAP Email/set call. Mark-read uses the `keywords/$seen` patch pointer so other
 * keywords (e.g. $flagged) are preserved.
 */
export function useBulkEmailActions() {
  const queryClient = useQueryClient()
  const accountId = usePrimaryAccountId()
  const updateEmail = useMailStore((state) => state.updateEmail)
  const deleteEmailFromStore = useMailStore((state) => state.deleteEmail)

  const markSeen = async (ids: string[], isRead: boolean) => {
    if (!accountId || ids.length === 0) return
    const update: Record<string, any> = {}
    ids.forEach((id) => {
      update[id] = { 'keywords/$seen': isRead }
    })
    await jmapClient.setEmail(accountId, update)
    await syncManager.patchCachedKeywords(ids, { $seen: isRead })
    ids.forEach((id) => updateEmail(id, { keywords: { $seen: isRead } as any }))
    queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
  }

  const remove = async (ids: string[]) => {
    if (!accountId || ids.length === 0) return
    await jmapClient.request([['Email/set', { accountId, destroy: ids }, '0']])
    await syncManager.removeCachedEmails(ids)
    ids.forEach((id) => deleteEmailFromStore(id))
    queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
  }

  // Move to a folder = replace the email's mailbox membership with the target.
  const move = async (ids: string[], mailboxId: string) => {
    if (!accountId || ids.length === 0) return
    const update: Record<string, any> = {}
    ids.forEach((id) => {
      update[id] = { mailboxIds: { [mailboxId]: true } }
    })
    await jmapClient.setEmail(accountId, update)
    await syncManager.setCachedMailbox(ids, mailboxId)
    queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    queryClient.invalidateQueries({ queryKey: ['mailboxes', accountId] })
  }

  return { markSeen, remove, move }
}

export function useDeleteEmail() {
  const queryClient = useQueryClient()
  const deleteEmailFromStore = useMailStore((state) => state.deleteEmail)

  return useMutation({
    mutationFn: async ({ accountId, emailId }: { accountId: string; emailId: string }) => {
      const result = await jmapClient.request([
        [
          'Email/set',
          {
            accountId,
            destroy: [emailId],
          },
          '0',
        ],
      ])

      await syncManager.removeCachedEmails([emailId])
      return result
    },
    onSuccess: (_, { emailId, accountId }) => {
      deleteEmailFromStore(emailId)
      queryClient.invalidateQueries({ queryKey: ['emails', accountId] })
    },
  })
}
