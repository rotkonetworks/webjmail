import { useMemo, useEffect, useRef, useState, memo, useCallback } from 'react'
import { useEmails, useEmailSearch, useDeleteEmail, usePrimaryAccountId } from '../../hooks'
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
  const searchQuery = useSearchStore((state) => state.query)
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
  
  const { data: serverSearchResults, isFetching: isSearching } = useEmailSearch(
    searchDebounce,
    searchDebounce.length > 2
  )
  
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const selectEmail = useMailStore((state) => state.selectEmail)
  
  const filteredEmails = useMemo(() => {
    if (searchDebounce && serverSearchResults) {
      return serverSearchResults
    }
    return emails
  }, [emails, serverSearchResults, searchDebounce])
  
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
  
  const handleEmailClick = useCallback((emailId: string) => {
    selectEmail(emailId)
    if (viewMode === 'row') {
      onSelectEmail?.(emailId)
    }
  }, [selectEmail, viewMode, onSelectEmail])
  
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
  
  if (filteredEmails.length === 0 && !isLoading && !isSearching) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center">
          <div className="i-lucide:inbox text-4xl text-[var(--text-tertiary)] mb-3" />
          <p className="text-[var(--text-secondary)]">
            {searchQuery ? 'No messages found' : 'No messages in this mailbox'}
          </p>
          {!searchQuery && (
            <p className="text-sm text-[var(--text-tertiary)] mt-2">
              Messages will appear here when they arrive
            </p>
          )}
          <button
            onClick={handleRefresh}
            className="mt-4 px-4 py-2 text-sm bg-[var(--primary-color)] text-white rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
    )
  }
  
  return (
    <div className="h-full flex flex-col">
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
      
      <div className="flex-1 overflow-y-auto">
        {filteredEmails.map((email) => {
          const isSelected = email.id === selectedEmailId
          const isUnread = !email.keywords.$seen
          const sender = email.from?.[0]
          const senderName = sender?.name || sender?.email?.split('@')[0] || 'Unknown'

          return (
            <div
              key={email.id}
              onClick={() => handleEmailClick(email.id)}
              className={`
                email-item cursor-pointer relative group px-4 py-3
                ${isSelected ? 'selected' : ''}
              `}
            >
              <div className="flex items-start gap-3">
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
