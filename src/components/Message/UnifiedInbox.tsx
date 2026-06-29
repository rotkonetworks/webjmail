import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react'
import { format } from 'date-fns'
import { useUnifiedInbox, type UnifiedEmail } from '../../hooks/email/useUnifiedInbox'
import { jmapClient } from '../../api/jmap'
import { useAuthStore } from '../../stores/authStore'
import { useMailStore } from '../../stores/mailStore'
import { useSearchStore } from '../../stores/searchStore'
import { toast } from '../../stores/toastStore'

interface UnifiedInboxProps {
  onSelectEmail?: (emailId: string) => void
}

// Composite selection key — ids are only unique within an account. JSON encoding
// avoids any separator-collision worry with account names or JMAP ids.
const keyOf = (e: UnifiedEmail) => JSON.stringify([e._account, e.id])
const splitKey = (k: string): [string, string] => JSON.parse(k) as [string, string]

export function UnifiedInbox({ onSelectEmail }: UnifiedInboxProps) {
  const { emails, isLoading, isFetching, refetch } = useUnifiedInbox()
  const activeAccount = useAuthStore((s) => s.activeAccount)
  const switchAccount = useAuthStore((s) => s.switchAccount)
  const selectedEmailId = useMailStore((s) => s.selectedEmailId)
  const selectEmail = useMailStore((s) => s.selectEmail)
  const searchQuery = useSearchStore((s) => s.query)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const anchorRef = useRef<string | null>(null)

  // Client-side search across the merged list (subject/sender/preview/account).
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return emails
    const terms = q.split(/\s+/).filter(Boolean)
    return emails.filter((e) => {
      const hay = `${e.subject || ''} ${e.from?.[0]?.name || ''} ${e.from?.[0]?.email || ''} ${
        e.preview || ''
      } ${e._account}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }, [emails, searchQuery])

  const open = useCallback(
    async (email: UnifiedEmail) => {
      if (email._account && email._account !== activeAccount) {
        await switchAccount(email._account, { quiet: true })
      }
      selectEmail(email.id)
      onSelectEmail?.(email.id)
    },
    [activeAccount, switchAccount, selectEmail, onSelectEmail]
  )

  const handleClick = useCallback(
    (e: MouseEvent, email: UnifiedEmail, index: number) => {
      const key = keyOf(email)
      if (e.shiftKey && anchorRef.current) {
        e.preventDefault()
        const anchorIdx = filtered.findIndex((x) => keyOf(x) === anchorRef.current)
        if (anchorIdx !== -1) {
          const [lo, hi] = anchorIdx < index ? [anchorIdx, index] : [index, anchorIdx]
          const range = filtered.slice(lo, hi + 1).map(keyOf)
          setSelected((prev) => {
            const next = new Set(prev)
            range.forEach((k) => next.add(k))
            return next
          })
        }
        return
      }
      if (e.metaKey || e.ctrlKey) {
        setSelected((prev) => {
          const next = new Set(prev)
          next.has(key) ? next.delete(key) : next.add(key)
          return next
        })
        anchorRef.current = key
        return
      }
      if (selected.size > 0) setSelected(new Set())
      anchorRef.current = key
      open(email)
    },
    [filtered, selected, open]
  )

  const allSelected = filtered.length > 0 && selected.size === filtered.length
  const toggleSelectAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(filtered.map(keyOf)))
  }, [allSelected, filtered])

  const toggleOne = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
    anchorRef.current = key
  }, [])

  // Group the selection by account and run a per-account op on each group.
  const runBulk = useCallback(
    async (fn: (account: string, ids: string[]) => Promise<void>, done: string) => {
      if (selected.size === 0) return
      const byAccount = new Map<string, string[]>()
      for (const k of selected) {
        const [acct, id] = splitKey(k)
        const arr = byAccount.get(acct) || []
        arr.push(id)
        byAccount.set(acct, arr)
      }
      setBulkBusy(true)
      try {
        for (const [acct, ids] of byAccount) await fn(acct, ids)
        setSelected(new Set())
        anchorRef.current = null
        await refetch()
        toast.success(done)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Action failed')
      } finally {
        setBulkBusy(false)
      }
    },
    [selected, refetch]
  )

  const seenUpdate = (ids: string[], isRead: boolean) => {
    const update: Record<string, any> = {}
    ids.forEach((id) => {
      update[id] = { 'keywords/$seen': isRead }
    })
    return update
  }
  const markRead = () =>
    runBulk((acct, ids) => jmapClient.setEmailAs(acct, seenUpdate(ids, true)), 'Marked as read')
  const markUnread = () =>
    runBulk((acct, ids) => jmapClient.setEmailAs(acct, seenUpdate(ids, false)), 'Marked as unread')
  const bulkDelete = () => {
    const n = selected.size
    if (n === 0) return
    if (!confirm(`Delete ${n} message${n > 1 ? 's' : ''}?`)) return
    runBulk(
      (acct, ids) => jmapClient.destroyEmailsAs(acct, ids),
      `Deleted ${n} message${n > 1 ? 's' : ''}`
    )
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin i-eos-icons:loading text-2xl text-[var(--text-tertiary)] mb-2" />
          <p className="text-[var(--text-tertiary)]">Loading all inboxes…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {selected.size > 0 ? (
        <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between sticky top-0 bg-[var(--bg-secondary)] z-10 gap-2">
          <div className="flex items-center gap-2 text-sm text-[var(--text-primary)] min-w-0">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = !allSelected && selected.size > 0
              }}
              onChange={toggleSelectAll}
              className="cursor-pointer"
            />
            <span className="font-medium whitespace-nowrap">{selected.size} selected</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="px-2 py-1 text-xs rounded hover:bg-white/10 disabled:opacity-50 flex items-center gap-1"
              onClick={markRead}
              disabled={bulkBusy}
            >
              <div className="i-lucide:mail-open" /> Read
            </button>
            <button
              className="px-2 py-1 text-xs rounded hover:bg-white/10 disabled:opacity-50 flex items-center gap-1"
              onClick={markUnread}
              disabled={bulkBusy}
            >
              <div className="i-lucide:mail" /> Unread
            </button>
            <button
              className="px-2 py-1 text-xs rounded hover:bg-red-500/20 text-red-400 disabled:opacity-50 flex items-center gap-1"
              onClick={bulkDelete}
              disabled={bulkBusy}
            >
              <div className="i-lucide:trash-2" /> Delete
            </button>
            <button
              className="p-1 ml-1 rounded hover:bg-white/10"
              onClick={() => setSelected(new Set())}
              title="Clear selection"
            >
              <div className="i-lucide:x text-sm" />
            </button>
          </div>
        </div>
      ) : (
        <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between sticky top-0 bg-[var(--bg-secondary)] z-10">
          <span className="text-sm text-[var(--text-secondary)] flex items-center gap-2">
            {isFetching && <div className="i-eos-icons:loading animate-spin" />}
            {searchQuery.trim() ? (
              <>
                <div className="i-lucide:search inline" /> {filtered.length} results
              </>
            ) : (
              <>
                <span className="font-medium">All inboxes</span>
                <span className="text-[var(--text-tertiary)]">{filtered.length}</span>
              </>
            )}
          </span>
          <button
            className="p-1 hover:bg-white/10 rounded"
            title="Refresh"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <div className={`i-lucide:refresh-cw text-sm ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center p-8">
            <div className="text-center">
              <div className="i-lucide:inbox text-4xl text-[var(--text-tertiary)] mb-3" />
              <p className="text-[var(--text-secondary)]">
                {searchQuery.trim()
                  ? `No results for “${searchQuery}”`
                  : 'No messages across your inboxes'}
              </p>
            </div>
          </div>
        ) : (
          filtered.map((email, index) => {
            const key = keyOf(email)
            const isSelected = email.id === selectedEmailId
            const isChecked = selected.has(key)
            const isUnread = !email.keywords?.$seen
            const sender = email.from?.[0]
            const senderName = sender?.name || sender?.email?.split('@')[0] || 'Unknown'
            return (
              <div
                key={key}
                onClick={(e) => handleClick(e, email, index)}
                className={`email-item cursor-pointer relative group px-4 py-3 select-none ${
                  isSelected ? 'selected' : ''
                } ${isChecked ? 'bg-[var(--primary-color)]/15' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`pt-0.5 ${
                      isChecked || selected.size > 0 ? '' : 'opacity-0 group-hover:opacity-100'
                    } transition-opacity`}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleOne(key)
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      tabIndex={-1}
                      className="cursor-pointer pointer-events-none"
                    />
                  </div>
                  <div className="pt-1.5">{isUnread && <div className="unread-dot" />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span
                        className={`truncate text-sm ${isUnread ? 'font-semibold' : 'font-medium'} ${
                          isSelected ? 'text-white' : 'text-[var(--text-primary)]'
                        }`}
                      >
                        {senderName}
                      </span>
                      <span className="text-xs text-[var(--text-tertiary)] flex-shrink-0">
                        {format(new Date(email.receivedAt), 'HH:mm')}
                      </span>
                    </div>
                    <div
                      className={`mb-0.5 truncate text-sm ${isUnread ? 'font-medium' : ''} ${
                        isSelected ? 'text-white' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {email.subject || '(no subject)'}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--accent-cyan)] text-[var(--on-accent)] truncate max-w-[45%]"
                        title={email._account}
                      >
                        {email._account}
                      </span>
                      <span
                        className={`truncate text-sm min-w-0 ${
                          isSelected ? 'text-white/70' : 'text-[var(--text-tertiary)]'
                        }`}
                      >
                        {email.preview || ''}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
