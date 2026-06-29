import { useMemo, useEffect, useRef, useState, memo, useCallback, type MouseEvent } from 'react'
import { useEmails, useDeleteEmail, useBulkEmailActions, useMailboxes, usePrimaryAccountId } from '../../hooks'
import { toast } from '../../stores/toastStore'
import { useOfflineSearch } from '../../hooks/useIndexedDB'
import { useMailStore } from '../../stores/mailStore'
import { useSearchStore } from '../../stores/searchStore'
import { format, isToday, isYesterday } from 'date-fns'
import DOMPurify from 'dompurify'
import { VariableSizeList as List } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'

interface MessageListProps {
  viewMode?: 'column' | 'row'
  onSelectEmail?: (emailId: string) => void
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)
  
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)
    
    return () => clearTimeout(handler)
  }, [value, delay])
  
  return debouncedValue
}

export const MessageList = memo(function MessageList({ viewMode = 'column', onSelectEmail }: MessageListProps) {
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const accountId = usePrimaryAccountId()
  const deleteEmailMutation = useDeleteEmail()
  const bulk = useBulkEmailActions()
  const { data: mailboxes } = useMailboxes()

  // Multi-select: a set of checked email ids + the anchor for shift-range.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const anchorRef = useRef<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const searchQuery = useSearchStore((state) => state.query)
  const setSearchQuery = useSearchStore((state) => state.setQuery)
  const searchDebounce = useDebouncedValue(searchQuery, 300)
  
  const {
    emails,
    isFetchingNextPage,
    hasMore,
    total,
    fetchNextPage,
    refetch,
    isLoading,
    isFetching,
  } = useEmails(selectedMailboxId)
  
  useEffect(() => {
    console.log('[MessageList] Debug:', {
      selectedMailboxId,
      accountId,
      emailsCount: emails.length,
      isLoading,
      isFetching,
      isFetchingNextPage,
      firstEmail: emails[0],
    })
  }, [selectedMailboxId, accountId, emails, isLoading, isFetching, isFetchingNextPage])
  
  const isRefreshing = isFetching && !isLoading && !isFetchingNextPage
  
  // Search the local index first (offline, full-text over bodies); the hook
  // falls back to a server query while the index is still warming up.
  const { data: localSearchResults, isFetching: isSearching } = useOfflineSearch(
    searchDebounce,
    searchDebounce.length > 2
  )
  
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const selectEmail = useMailStore((state) => state.selectEmail)
  
  const filteredEmails = useMemo(() => {
    if (searchDebounce && localSearchResults) {
      return localSearchResults
    }
    return emails
  }, [emails, localSearchResults, searchDebounce])

  // Reset multi-selection when the visible set changes (mailbox / search).
  useEffect(() => {
    setSelectedIds(new Set())
    anchorRef.current = null
  }, [selectedMailboxId, searchDebounce])

  const toggleId = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    anchorRef.current = id
  }, [])

  const allSelected = filteredEmails.length > 0 && selectedIds.size === filteredEmails.length
  const toggleSelectAll = useCallback(() => {
    setSelectedIds(allSelected ? new Set() : new Set(filteredEmails.map((e) => e.id)))
  }, [allSelected, filteredEmails])

  const runBulk = useCallback(
    async (fn: (ids: string[]) => Promise<void>, done: string) => {
      const ids = Array.from(selectedIds)
      if (ids.length === 0) return
      setBulkBusy(true)
      try {
        await fn(ids)
        setSelectedIds(new Set())
        anchorRef.current = null
        toast.success(done)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Action failed')
      } finally {
        setBulkBusy(false)
      }
    },
    [selectedIds]
  )

  const handleBulkDelete = useCallback(() => {
    const n = selectedIds.size
    if (n === 0) return
    if (!confirm(`Delete ${n} message${n > 1 ? 's' : ''}?`)) return
    runBulk((ids) => bulk.remove(ids), `Deleted ${n} message${n > 1 ? 's' : ''}`)
  }, [selectedIds, runBulk, bulk])

  const handleBulkRead = useCallback(
    () => runBulk((ids) => bulk.markSeen(ids, true), 'Marked as read'),
    [runBulk, bulk]
  )
  const handleBulkUnread = useCallback(
    () => runBulk((ids) => bulk.markSeen(ids, false), 'Marked as unread'),
    [runBulk, bulk]
  )
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const handleBulkMove = useCallback(
    (mailboxId: string, mailboxName: string) => {
      setShowMoveMenu(false)
      runBulk((ids) => bulk.move(ids, mailboxId), `Moved to ${mailboxName}`)
    },
    [runBulk, bulk]
  )

  const handleDeleteEmail = useCallback(async (emailId: string) => {
    if (!accountId) return
    
    const email = emails.find(e => e.id === emailId)
    if (!email) return
    
    const isSpam = email.keywords.$junk || false
    if (!isSpam && !confirm('Delete this message?')) {
      return
    }
    
    try {
      await deleteEmailMutation.mutateAsync({ accountId, emailId })
      
      const currentIndex = filteredEmails.findIndex(e => e.id === emailId)
      if (currentIndex !== -1 && filteredEmails.length > 1) {
        const nextIndex = currentIndex < filteredEmails.length - 1 ? currentIndex : currentIndex - 1
        const nextEmail = filteredEmails[nextIndex]
        if (nextEmail && nextEmail.id !== emailId) {
          selectEmail(nextEmail.id)
        }
      } else {
        selectEmail(null)
      }
    } catch (error) {
      console.error('Failed to delete email:', error)
    }
  }, [accountId, emails, filteredEmails, deleteEmailMutation, selectEmail])
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't hijack single-key shortcuts (j/k/d/Enter) while the user is
      // typing in a field — search box, composer, any input/textarea/editor.
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }

      if (e.key === 'Enter' && selectedEmailId) {
        e.preventDefault()
        onSelectEmail?.(selectedEmailId)
      }

      if ((e.key === 'Delete' || e.key === 'd') && selectedEmailId && accountId) {
        e.preventDefault()
        handleDeleteEmail(selectedEmailId)
      }
      
      if ((e.key === 'ArrowDown' || e.key === 'j') && filteredEmails.length > 0) {
        e.preventDefault()
        const currentIndex = filteredEmails.findIndex(email => email.id === selectedEmailId)
        const nextIndex = Math.min(currentIndex + 1, filteredEmails.length - 1)
        if (nextIndex !== currentIndex || currentIndex === -1) {
          const newEmail = filteredEmails[nextIndex === -1 ? 0 : nextIndex]
          selectEmail(newEmail.id)
        }
      }
      
      if ((e.key === 'ArrowUp' || e.key === 'k') && filteredEmails.length > 0) {
        e.preventDefault()
        const currentIndex = filteredEmails.findIndex(email => email.id === selectedEmailId)
        const prevIndex = Math.max(currentIndex - 1, 0)
        if (prevIndex !== currentIndex) {
          selectEmail(filteredEmails[prevIndex].id)
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEmailId, onSelectEmail, filteredEmails, accountId, selectEmail, handleDeleteEmail])
  
  const handleEmailClick = useCallback(
    (e: MouseEvent, emailId: string, index: number) => {
      // Shift-click → select the range from the anchor to here.
      if (e.shiftKey && anchorRef.current) {
        e.preventDefault()
        const anchorIndex = filteredEmails.findIndex((x) => x.id === anchorRef.current)
        if (anchorIndex !== -1) {
          const [lo, hi] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex]
          const range = filteredEmails.slice(lo, hi + 1).map((x) => x.id)
          setSelectedIds((prev) => {
            const next = new Set(prev)
            range.forEach((id) => next.add(id))
            return next
          })
        }
        return
      }
      // Cmd/Ctrl-click → toggle this one in the selection.
      if (e.metaKey || e.ctrlKey) {
        toggleId(emailId)
        return
      }
      // Plain click → clear any multi-selection and open the email.
      if (selectedIds.size > 0) setSelectedIds(new Set())
      anchorRef.current = emailId
      selectEmail(emailId)
      if (viewMode === 'row') {
        onSelectEmail?.(emailId)
      }
    },
    [filteredEmails, selectedIds, toggleId, selectEmail, viewMode, onSelectEmail]
  )
  
  const loadMoreRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || isFetchingNextPage || searchDebounce) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage && hasMore) {
          console.log('[MessageList] Loading more emails...')
          fetchNextPage()
        }
      },
      {
        threshold: 0.1,
        rootMargin: '100px'
      }
    )

    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [hasMore, isFetchingNextPage, fetchNextPage, searchDebounce])
  
  const handleRefresh = useCallback(() => {
    refetch()
  }, [refetch])
  
  if (!selectedMailboxId) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[var(--text-tertiary)]">Select a mailbox</p>
      </div>
    )
  }
  
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin i-eos-icons:loading text-2xl text-[var(--text-tertiary)] mb-2" />
          <p className="text-[var(--text-tertiary)]">Loading messages...</p>
        </div>
      </div>
    )
  }
  
  if (isSearching && filteredEmails.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin i-eos-icons:loading text-2xl text-[var(--text-tertiary)] mb-2" />
          <p className="text-[var(--text-tertiary)]">Searching…</p>
        </div>
      </div>
    )
  }

  if (filteredEmails.length === 0 && !isLoading && !isSearching) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center">
          <div className="i-lucide:inbox text-4xl text-[var(--text-tertiary)] mb-3" />
          <p className="text-[var(--text-secondary)]">
            {searchQuery ? `No results for “${searchQuery}”` : 'No messages in this mailbox'}
          </p>
          {!searchQuery && (
            <p className="text-sm text-[var(--text-tertiary)] mt-2">
              Messages will appear here when they arrive
            </p>
          )}
          <button
            onClick={searchQuery ? () => setSearchQuery('') : handleRefresh}
            className="mt-4 px-4 py-2 text-sm bg-[var(--primary-color)] text-[var(--on-primary)] rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
          >
            {searchQuery ? 'Clear search' : 'Refresh'}
          </button>
        </div>
      </div>
    )
  }
  
  return (
    <div className="h-full flex flex-col">
      {selectedIds.size > 0 ? (
        <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between sticky top-0 bg-[var(--bg-secondary)] z-10 gap-2">
          <div className="flex items-center gap-2 text-sm text-[var(--text-primary)] min-w-0">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = !allSelected && selectedIds.size > 0
              }}
              onChange={toggleSelectAll}
              title={allSelected ? 'Deselect all' : 'Select all'}
              className="cursor-pointer"
            />
            <span className="font-medium whitespace-nowrap">{selectedIds.size} selected</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="px-2 py-1 text-xs rounded hover:bg-white/10 transition-colors disabled:opacity-50 flex items-center gap-1"
              onClick={handleBulkRead}
              disabled={bulkBusy}
              title="Mark as read"
            >
              <div className="i-lucide:mail-open" /> Read
            </button>
            <button
              className="px-2 py-1 text-xs rounded hover:bg-white/10 transition-colors disabled:opacity-50 flex items-center gap-1"
              onClick={handleBulkUnread}
              disabled={bulkBusy}
              title="Mark as unread"
            >
              <div className="i-lucide:mail" /> Unread
            </button>
            <div className="relative">
              <button
                className={`px-2 py-1 text-xs rounded hover:bg-white/10 transition-colors disabled:opacity-50 flex items-center gap-1 ${showMoveMenu ? 'bg-white/10' : ''}`}
                onClick={() => setShowMoveMenu((v) => !v)}
                disabled={bulkBusy}
                title="Move to folder"
              >
                <div className="i-lucide:folder-input" /> Move
              </button>
              {showMoveMenu && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowMoveMenu(false)} />
                  <div className="absolute right-0 mt-1 z-30 w-56 max-h-[50vh] overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl py-1">
                    {(mailboxes || [])
                      .filter((mb) => mb.id !== selectedMailboxId)
                      .map((mb) => (
                        <button
                          key={mb.id}
                          onClick={() => handleBulkMove(mb.id, mb.name)}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)] flex items-center gap-2 truncate"
                        >
                          <div className="i-lucide:folder text-[var(--text-tertiary)] flex-shrink-0" />
                          <span className="truncate">{mb.name}</span>
                        </button>
                      ))}
                    {(mailboxes || []).filter((mb) => mb.id !== selectedMailboxId).length === 0 && (
                      <div className="px-3 py-1.5 text-xs text-[var(--text-tertiary)]">No other folders</div>
                    )}
                  </div>
                </>
              )}
            </div>
            <button
              className="px-2 py-1 text-xs rounded hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-50 flex items-center gap-1"
              onClick={handleBulkDelete}
              disabled={bulkBusy}
              title="Delete selected"
            >
              <div className="i-lucide:trash-2" /> Delete
            </button>
            <button
              className="p-1 ml-1 rounded hover:bg-white/10 transition-colors"
              onClick={() => setSelectedIds(new Set())}
              title="Clear selection"
            >
              <div className="i-lucide:x text-sm" />
            </button>
          </div>
        </div>
      ) : (
        <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between sticky top-0 bg-[var(--bg-secondary)] z-10">
          <span className="text-sm text-[var(--text-secondary)]">
            {isRefreshing && (
              <div className="i-eos-icons:loading animate-spin inline mr-2" />
            )}
            {searchDebounce ? (
              <>
                <div className="i-lucide:search inline mr-1" />
                {isSearching ? 'Searching...' : `${filteredEmails.length} results`}
              </>
            ) : (
              <>
                {filteredEmails.length} {filteredEmails.length === 1 ? 'conversation' : 'conversations'}
              </>
            )}
          </span>
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <button
              className="p-1 hover:bg-white/10 rounded transition-colors"
              title="Refresh (⌘R)"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <div className={`i-lucide:refresh-cw text-sm ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {filteredEmails.map((email, index) => {
          const isSelected = email.id === selectedEmailId
          const isChecked = selectedIds.has(email.id)
          const isUnread = !email.keywords.$seen
          const sender = email.from?.[0]
          const senderName = sender?.name || sender?.email?.split('@')[0] || 'Unknown'

          return (
            <div
              key={email.id}
              onClick={(e) => handleEmailClick(e, email.id, index)}
              className={`
                email-item cursor-pointer relative group px-4 py-3 select-none
                ${isSelected ? 'selected' : ''}
                ${isChecked ? 'bg-[var(--primary-color)]/15' : ''}
              `}
            >
              <div className="flex items-start gap-3">
                {/* Selection checkbox — visible on hover or when a selection is active */}
                <div
                  className={`pt-0.5 ${isChecked || selectedIds.size > 0 ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleId(email.id)
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
                <div className="pt-1.5">
                  {isUnread && <div className="unread-dot" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className={`
                      truncate text-sm
                      ${isUnread ? 'font-semibold' : 'font-medium'}
                      ${isSelected ? 'text-white' : 'text-[var(--text-primary)]'}
                    `}>
                      {senderName}
                    </span>
                    <span className="text-xs text-[var(--text-tertiary)] flex-shrink-0">
                      {format(new Date(email.receivedAt), 'HH:mm')}
                    </span>
                  </div>

                  <div className={`
                    mb-0.5 truncate text-sm
                    ${isUnread ? 'font-medium' : ''}
                    ${isSelected ? 'text-white' : 'text-[var(--text-primary)]'}
                  `}>
                    {email.subject || '(no subject)'}
                  </div>

                  <div className={`
                    truncate text-sm
                    ${isSelected ? 'text-white/70' : 'text-[var(--text-tertiary)]'}
                  `}>
                    {email.preview || ''}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        
        {!searchDebounce && hasMore && (
          <div ref={loadMoreRef} className="p-4 text-center">
            {isFetchingNextPage ? (
              <div className="flex items-center justify-center gap-2 text-[var(--text-tertiary)]">
                <div className="animate-spin i-eos-icons:loading" />
                <span className="text-sm">Loading more messages...</span>
              </div>
            ) : (
              <span className="text-sm text-[var(--text-tertiary)]">Scroll for more</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
