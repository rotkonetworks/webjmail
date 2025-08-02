// src/components/Message/MessageList.tsx - Simplified without offline-first
import React, { useMemo, useEffect, useRef, useState } from 'react'
import { useEmails, useEmailSearch } from '../../hooks/useJMAP'
import { useMailStore } from '../../stores/mailStore'
import { format, isToday, isYesterday } from 'date-fns'
import DOMPurify from 'dompurify'

interface MessageListProps {
  searchQuery: string
  viewMode?: 'column' | 'row'
  onSelectEmail?: (emailId: string) => void
}

export function MessageList({ searchQuery, viewMode = 'column', onSelectEmail }: MessageListProps) {
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)

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

  const [searchDebounce, setSearchDebounce] = useState('')
  
  // Track if we're loading/refreshing
  const isRefreshing = isFetching && !isFetchingNextPage
  
  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchDebounce(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Server search
  const { data: serverSearchResults, isFetching: isSearching } = useEmailSearch(
    searchDebounce,
    searchDebounce.length > 2
  )

  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const selectEmail = useMailStore((state) => state.selectEmail)
  const listRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)

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

  // Handle Enter key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && selectedEmailId) {
        e.preventDefault()
        onSelectEmail?.(selectedEmailId)
      }
    }

    const listElement = listRef.current
    if (listElement) {
      listElement.addEventListener('keydown', handleKeyDown)
      return () => listElement.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedEmailId, onSelectEmail])

  // Filter emails
  const filteredEmails = useMemo(() => {
    // Use search results if searching
    if (searchDebounce && serverSearchResults) {
      return serverSearchResults
    }

    // Return all emails if not searching
    return emails
  }, [emails, serverSearchResults, searchDebounce])

  const formatEmailDate = (dateString: string): string => {
    const date = new Date(dateString)
    if (isToday(date)) return format(date, 'HH:mm')
    if (isYesterday(date)) return 'Yesterday'
    return format(date, 'MMM d')
  }

  // Security: Escape regex special characters to prevent ReDoS attacks
  const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  // Security: Sanitize and validate input to prevent XSS and injection attacks
  const sanitizeText = (text: string): string => {
    if (!text || typeof text !== 'string') return ''
    // Limit length to prevent DoS
    if (text.length > 10000) text = text.substring(0, 10000)
    return DOMPurify.sanitize(text, { ALLOWED_TAGS: [] })
  }

  const highlightText = (text: string, query: string) => {
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
  }

  const handleRefresh = () => {
    console.log('[MessageList] Manual refresh triggered')
    refetch()
  }

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
      {/* Header */}
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
          <button
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="Refresh"
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
            onClick={() => {
              selectEmail(email.id)
              if (viewMode === 'row') {
                onSelectEmail?.(email.id)
              }
            }}
            className={`
              email-item cursor-pointer
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
}
