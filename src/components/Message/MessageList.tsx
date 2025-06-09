import React, { useMemo, useEffect, useRef, useState } from 'react'
import { useEmails, useEmailSearch } from '../../hooks/useJMAP'
import { useOfflineEmails, useOfflineSearch } from '../../hooks/useIndexedDB'
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
  
  // Use offline-first email loading
  const { 
    data: offlineData,
    isLoading,
    refetch
  } = useOfflineEmails(selectedMailboxId)
  
  // Fallback to online for infinite scroll if needed
  const { 
    emails: onlineEmails, 
    isFetchingNextPage,
    hasMore,
    total: onlineTotal,
    fetchNextPage,
  } = useEmails(selectedMailboxId)
  
  const [searchDebounce, setSearchDebounce] = useState('')
  const [showServerSearch, setShowServerSearch] = useState(false)
  
  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchDebounce(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])
  
  // Offline search first
  const { data: offlineSearchResults } = useOfflineSearch(
    searchDebounce,
    searchDebounce.length > 2 && !showServerSearch
  )
  
  // Server search as fallback
  const { data: serverSearchResults, isFetching: isSearching } = useEmailSearch(
    searchDebounce, 
    showServerSearch
  )
  
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const selectEmail = useMailStore((state) => state.selectEmail)
  const listRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  
  // Intersection observer for infinite scroll with improved cleanup
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || showServerSearch) return
    
    const element = loadMoreRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 }
    )
    
    try {
      observer.observe(element)
      return () => {
        try {
          observer.disconnect()
        } catch (error) {
          console.warn('Observer cleanup failed:', error)
        }
      }
    } catch (error) {
      console.warn('Observer setup failed:', error)
      observer.disconnect()
    }
  }, [hasMore, isFetchingNextPage, fetchNextPage, showServerSearch])
  
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
  
  // Determine data source with offline-first approach
  const emails = offlineData?.emails || onlineEmails || []
  const total = offlineData?.total || onlineTotal || 0
  const fromCache = offlineData?.fromCache || false
  
  // Filter emails with offline-first search
  const filteredEmails = useMemo(() => {
    // Use search results if searching
    if (searchDebounce) {
      if (showServerSearch && serverSearchResults) {
        return serverSearchResults
      } else if (offlineSearchResults) {
        return offlineSearchResults
      } else if (!showServerSearch) {
        // Local filter as fallback
        const query = searchDebounce.toLowerCase()
        return emails.filter(email => 
          email.subject?.toLowerCase().includes(query) ||
          email.from?.[0]?.email?.toLowerCase().includes(query) ||
          email.from?.[0]?.name?.toLowerCase().includes(query) ||
          email.preview?.toLowerCase().includes(query)
        )
      }
    }
    
    // Return all emails if not searching
    return emails.sort((a, b) => 
      new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
    )
  }, [emails, offlineSearchResults, serverSearchResults, searchDebounce, showServerSearch])
  
  // Auto-enable server search if local results are insufficient
  useEffect(() => {
    if (searchDebounce && filteredEmails.length === 0 && !showServerSearch && !isLoading) {
      const timer = setTimeout(() => {
        setShowServerSearch(true)
      }, 500)
      return () => clearTimeout(timer)
    } else if (!searchDebounce) {
      setShowServerSearch(false)
    }
  }, [searchDebounce, filteredEmails.length, showServerSearch, isLoading])
  
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
        part.toLowerCase() === query.toLowerCase() 
          ? <span key={i} className="search-highlight">{part}</span>
          : part
      )
    } catch (error) {
      // Fallback if regex fails
      console.warn('Regex highlighting failed:', error)
      return sanitizedText
    }
  }
  
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
        <div className="animate-spin i-eos-icons:loading text-2xl text-[var(--text-tertiary)]" />
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
          {searchQuery && (
            <p className="text-sm text-[var(--text-tertiary)] mt-1">
              {showServerSearch ? 'No results on server' : 'Searching server...'}
            </p>
          )}
        </div>
      </div>
    )
  }
  
  return (
    <div className="h-full overflow-y-auto" ref={listRef} tabIndex={0}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between sticky top-0 bg-[var(--bg-secondary)] z-10">
        <span className="text-sm text-[var(--text-secondary)]">
          {showServerSearch ? (
            <>
              <div className="i-lucide:search inline mr-1" />
              {isSearching ? 'Searching...' : `${filteredEmails.length} results`}
            </>
          ) : searchDebounce && offlineSearchResults ? (
            <>
              <div className="i-lucide:database inline mr-1" />
              {filteredEmails.length} offline results
            </>
          ) : total > 0 ? (
            <>
              {fromCache && <div className="i-lucide:database inline mr-1" title="From cache" />}
              {filteredEmails.length} of {total} {total === 1 ? 'conversation' : 'conversations'}
            </>
          ) : (
            <>
              {fromCache && <div className="i-lucide:database inline mr-1" title="From cache" />}
              {filteredEmails.length} {filteredEmails.length === 1 ? 'conversation' : 'conversations'}
            </>
          )}
        </span>
        <div className="flex items-center gap-2">
          {showServerSearch && (
            <button 
              className="text-xs text-[var(--primary-color)] hover:underline" 
              onClick={() => {
                setShowServerSearch(false)
                setSearchDebounce('')
              }}
            >
              Clear search
            </button>
          )}
          <button 
            className="p-1 hover:bg-white/10 rounded" 
            title="Refresh"
            onClick={() => refetch()}
          >
            <div className="i-lucide:refresh-cw text-sm" />
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
              onSelectEmail?.(email.id)
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
                  <span className={`
                    truncate
                    ${viewMode === 'row' ? 'text-base' : 'text-sm'}
                    ${isUnread ? 'font-semibold' : 'font-medium'}
                    ${isSelected ? 'text-white' : 'text-[var(--text-primary)]'}
                  `}>
                    {searchQuery ? highlightText(senderName, searchQuery) : sanitizeText(senderName)}
                  </span>
                  <span className={`
                    ${viewMode === 'row' ? 'text-sm' : 'text-xs'} 
                    text-[var(--text-tertiary)] flex-shrink-0
                  `}>
                    {formatEmailDate(email.receivedAt)}
                  </span>
                </div>
                
                {/* Subject */}
                <div className={`
                  mb-0.5 truncate
                  ${viewMode === 'row' ? 'text-base' : 'text-sm'}
                  ${isUnread ? 'font-medium' : ''}
                  ${isSelected ? 'text-white' : 'text-[var(--text-primary)]'}
                `}>
                  {searchQuery ? highlightText(email.subject || '(no subject)', searchQuery) : sanitizeText(email.subject || '(no subject)')}
                </div>
                
                {/* Preview */}
                <div className={`
                  truncate
                  ${viewMode === 'row' ? 'text-sm' : 'text-sm'}
                  ${isSelected ? 'text-white/70' : 'text-[var(--text-tertiary)]'}
                `}>
                  {searchQuery ? highlightText(email.preview || '', searchQuery) : sanitizeText(email.preview || '')}
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
                  {showServerSearch && (
                    <span className="label label-green">
                      <div className="i-lucide:search inline w-3 h-3 mr-1" />
                      Server result
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
      {!showServerSearch && (
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
              >
                Load more
              </button>
            )
          ) : filteredEmails.length > 0 && total > 0 && filteredEmails.length >= total ? (
            <div className="flex items-center justify-center gap-2 text-[var(--text-tertiary)]">
              <div className="i-lucide:check-circle text-sm" />
              <span className="text-sm">All messages loaded ({total} total)</span>
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
