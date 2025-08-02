// src/components/Message/MessageList.tsx
import { useMemo, useEffect, useRef, useState, memo, useCallback } from 'react'
import { useEmails, useEmailSearch, useDeleteEmail, usePrimaryAccountId } from '../../hooks'
import { useMailStore } from '../../stores/mailStore'
import { useSearchStore } from '../../stores/searchStore'
import { format, isToday, isYesterday } from 'date-fns'
import DOMPurify from 'dompurify'

interface MessageListProps {
  viewMode?: 'column' | 'row'
  onSelectEmail?: (emailId: string) => void
}

// Custom hook for debounced value
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

export const MessageList = memo(function MessageList({ viewMode = 'column', onSelectEmail }: MessageListProps) {
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const accountId = usePrimaryAccountId()
  const deleteEmailMutation = useDeleteEmail()
  
  // Get search query from store
  const searchQuery = useSearchStore((state) => state.query)
  
  // Use online emails directly
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
  
  // Track if we're loading/refreshing
  const isRefreshing = isFetching && !isFetchingNextPage
  
  // Debounce search query
  const searchDebounce = useDebouncedValue(searchQuery, 300)
  
  // Server search
  const { data: serverSearchResults, isFetching: isSearching } = useEmailSearch(
    searchDebounce,
    searchDebounce.length > 2
  )
  
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const selectEmail = useMailStore((state) => state.selectEmail)
  const listRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  
  // Filter emails - MOVED BEFORE useEffect to fix reference error
  const filteredEmails = useMemo(() => {
    // Use search results if searching
    if (searchDebounce && serverSearchResults) {
      return serverSearchResults
    }
    // Return all emails if not searching
    return emails
  }, [emails, serverSearchResults, searchDebounce])
  
  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || isFetchingNextPage || searchDebounce) return
    
    const element = loadMoreRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage && hasMore) {
          console.log('[MessageList] Triggering fetchNextPage')
          fetchNextPage()
        }
      },
      { 
        threshold: 0.1, 
        rootMargin: '100px'
      }
    )
    
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [hasMore, isFetchingNextPage, fetchNextPage, searchDebounce])
  
  // Memoized delete handler
  const handleDeleteEmail = useCallback(async (emailId: string) => {
    if (!accountId) return
    
    const email = emails.find(e => e.id === emailId)
    if (!email) return
    
    // Optional: Add confirmation for non-spam emails
    const isSpam = email.keywords.$junk || false
    if (!isSpam && !confirm('Delete this message?')) {
      return
    }
    
    try {
      await deleteEmailMutation.mutateAsync({ accountId, emailId })
      
      // Select next email after deletion
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
  
  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Enter key to open email
      if (e.key === 'Enter' && selectedEmailId) {
        e.preventDefault()
        onSelectEmail?.(selectedEmailId)
      }
      
      // Delete key to delete selected email
      if ((e.key === 'Delete' || e.key === 'd') && selectedEmailId && accountId) {
        e.preventDefault()
        handleDeleteEmail(selectedEmailId)
      }
      
      // Arrow keys for navigation
      if ((e.key === 'ArrowDown' || e.key === 'j') && filteredEmails.length > 0) {
        e.preventDefault()
        const currentIndex = filteredEmails.findIndex(email => email.id === selectedEmailId)
        const nextIndex = Math.min(currentIndex + 1, filteredEmails.length - 1)
        if (nextIndex !== currentIndex || currentIndex === -1) {
          selectEmail(filteredEmails[nextIndex === -1 ? 0 : nextIndex].id)
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
    
    const listElement = listRef.current
    if (listElement) {
      listElement.addEventListener('keydown', handleKeyDown)
      return () => listElement.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedEmailId, onSelectEmail, filteredEmails, accountId, selectEmail, handleDeleteEmail])
  
  const formatEmailDate = useCallback((dateString: string): string => {
    const date = new Date(dateString)
    if (isToday(date)) return format(date, 'HH:mm')
    if (isYesterday(date)) return 'Yesterday'
    return format(date, 'MMM d')
  }, [])
  
  // Security: Escape regex special characters to prevent ReDoS attacks
  const escapeRegex = useCallback((str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }, [])
  
  // Security: Sanitize and validate input to prevent XSS and injection attacks
  const sanitizeText = useCallback((text: string): string => {
    if (!text || typeof text !== 'string') return ''
    // Limit length to prevent DoS
    if (text.length > 10000) text = text.substring(0, 10000)
    return DOMPurify.sanitize(text, { ALLOWED_TAGS: [] })
  }, [])
  
  const highlightText = useCallback((text: string, query: string) => {
    if (!query || !text) return sanitizeText(text)
    // Security: Validate and limit query length
    if (query.length > 100) return sanitizeText(text)
    // Security: Escape regex special characters to prevent ReDoS
    const escapedQuery = escapeRegex(query)
    const sanitizedText = sanitizeText(text)
    
    try {
      const parts = sanitizedText.split(new RegExp(`(${escapedQuery})`, 'gi'))
      return parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <span key={i} className="search-highlight">
            {part}
          </span>
        ) : (
          part
        )
      )
    } catch (error) {
      // Fallback if regex fails
      console.warn('Regex highlighting failed:', error)
      return sanitizedText
    }
  }, [sanitizeText, escapeRegex])
  
  const handleRefresh = useCallback(() => {
    console.log('[MessageList] Manual refresh triggered')
    refetch()
  }, [refetch])
  
  // Memoized click handlers
  const handleEmailClick = useCallback((emailId: string) => {
    selectEmail(emailId)
    if (viewMode === 'row') {
      onSelectEmail?.(emailId)
    }
  }, [selectEmail, viewMode, onSelectEmail])
  
  const handleEmailDoubleClick = useCallback((emailId: string) => {
    if (viewMode === 'column' && emailId === selectedEmailId) {
      onSelectEmail?.(emailId)
    }
  }, [viewMode, selectedEmailId, onSelectEmail])
  
  if (!selectedMailboxId) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[var(--text-tertiary)]">Select a mailbox</p>
      </div>
    )
  }
  
  if (isLoading && filteredEmails.length === 0) {
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
          <div className="i-lucide:search-x text-4xl text-[var(--text-tertiary)] mb-3" />
          <p className="text-[var(--text-secondary)]">
            {searchQuery ? 'No messages found' : 'No messages in this mailbox'}
          </p>
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
    <div className="h-full overflow-y-auto" ref={listRef} tabIndex={0}>
      {/* Header with keyboard shortcuts info */}
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
          ) : total > 0 ? (
            <>
              {filteredEmails.length} of {total} {total === 1 ? 'conversation' : 'conversations'}
            </>
          ) : (
            <>
              {filteredEmails.length}{' '}
              {filteredEmails.length === 1 ? 'conversation' : 'conversations'}
            </>
          )}
        </span>
        <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
          <span className="hidden sm:inline">↑↓ Navigate • Enter Open • D Delete</span>
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
      
      {/* Email list */}
      {filteredEmails.map((email) => {
        const isSelected = email.id === selectedEmailId
        const isUnread = !email.keywords.$seen
        const sender = email.from?.[0]
        const senderName = sanitizeText(sender?.name || sender?.email?.split('@')[0] || 'Unknown')
        
        return (
          <div
            key={email.id}
            onClick={() => handleEmailClick(email.id)}
            onDoubleClick={() => handleEmailDoubleClick(email.id)}
            className={`
              email-item cursor-pointer relative group
              ${isSelected ? 'selected' : ''}
              ${viewMode === 'row' ? 'px-6 py-4' : 'px-4 py-3'}
            `}
          >
            <div className={`flex items-start gap-3 ${viewMode === 'row' ? 'gap-4' : 'gap-3'}`}>
              {/* Unread indicator */}
              <div className={viewMode === 'row' ? 'pt-2' : 'pt-1.5'}>
                {isUnread && <div className="unread-dot" />}
              </div>
              
              {/* Content */}
              <div className="flex-1 min-w-0">
                {/* Header row */}
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span
                    className={`
                    truncate
                    ${viewMode === 'row' ? 'text-base' : 'text-sm'}
                    ${isUnread ? 'font-semibold' : 'font-medium'}
                    ${isSelected ? 'text-white' : 'text-[var(--text-primary)]'}
                  `}
                  >
                    {searchQuery
                      ? highlightText(senderName, searchQuery)
                      : sanitizeText(senderName)}
                  </span>
                  <span
                    className={`
                    ${viewMode === 'row' ? 'text-sm' : 'text-xs'}
                     text-[var(--text-tertiary)] flex-shrink-0
                  `}
                  >
                    {formatEmailDate(email.receivedAt)}
                  </span>
                </div>
                
                {/* Subject */}
                <div
                  className={`
                  mb-0.5 truncate
                  ${viewMode === 'row' ? 'text-base' : 'text-sm'}
                  ${isUnread ? 'font-medium' : ''}
                  ${isSelected ? 'text-white' : 'text-[var(--text-primary)]'}
                `}
                >
                  {searchQuery
                    ? highlightText(email.subject || '(no subject)', searchQuery)
                    : sanitizeText(email.subject || '(no subject)')}
                </div>
                
                {/* Preview */}
                <div
                  className={`
                  truncate
                  ${viewMode === 'row' ? 'text-sm' : 'text-sm'}
                  ${isSelected ? 'text-white/70' : 'text-[var(--text-tertiary)]'}
                `}
                >
                  {searchQuery
                    ? highlightText(email.preview || '', searchQuery)
                    : sanitizeText(email.preview || '')}
                </div>
                
                {/* Labels */}
                <div className="flex items-center gap-2 mt-1">
                  {email.keywords.$flagged && (
                    <span className="label label-pink">
                      <div className="i-lucide:star inline w-3 h-3 mr-1" />
                      Starred
                    </span>
                  )}
                  {email.hasAttachment && (
                    <span className="label label-blue">
                      <div className="i-lucide:paperclip inline w-3 h-3 mr-1" />
                      Attachment
                    </span>
                  )}
                </div>
              </div>
              
              {/* Quick action buttons - show on hover */}
              <div className={`
                absolute right-4 top-1/2 -translate-y-1/2
                opacity-0 group-hover:opacity-100 transition-opacity
                flex items-center gap-1
                ${isSelected ? 'opacity-100' : ''}
              `}>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteEmail(email.id)
                  }}
                  className="p-1.5 hover:bg-red-500/20 rounded transition-colors"
                  title="Delete (D)"
                >
                  <div className="i-lucide:trash-2 text-sm text-red-400" />
                </button>
              </div>
              
              {/* Row mode extras */}
              {viewMode === 'row' && (
                <div className="flex items-center gap-3 text-[var(--text-tertiary)]">
                  {email.to && email.to.length > 1 && (
                    <span className="text-sm">+{email.to.length - 1}</span>
                  )}
                  <div className="text-sm">{Math.round(email.size / 1024)} KB</div>
                </div>
              )}
            </div>
          </div>
        )
      })}
      
      {/* Load more */}
      {!searchDebounce && emails.length > 0 && (
        <div ref={loadMoreRef} className="p-4 text-center">
          {hasMore ? (
            isFetchingNextPage ? (
              <div className="flex items-center justify-center gap-2 text-[var(--text-tertiary)]">
                <div className="animate-spin i-eos-icons:loading" />
                <span className="text-sm">Loading more messages...</span>
              </div>
            ) : (
              <button
                onClick={() => fetchNextPage()}
                className="text-sm text-[var(--primary-color)] hover:underline"
                disabled={isFetchingNextPage}
              >
                Load more
              </button>
            )
          ) : emails.length > 0 && total > 0 ? (
            <div className="flex items-center justify-center gap-2 text-[var(--text-tertiary)]">
              <div className="i-lucide:check-circle text-sm" />
              <span className="text-sm">All {total} messages loaded</span>
            </div>
          ) : null}
        </div>
      )}
      
      {/* Server search indicator */}
      {isSearching && (
        <div className="p-4 text-center text-[var(--text-tertiary)]">
          <div className="animate-spin i-eos-icons:loading inline mr-2" />
          <span className="text-sm">Searching server...</span>
        </div>
      )}
    </div>
  )
})
