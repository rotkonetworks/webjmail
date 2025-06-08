import React, { useMemo, useEffect, useRef } from 'react'
import { useEmails } from '../../hooks/useJMAP'
import { useMailStore } from '../../stores/mailStore'
import { format, isToday, isYesterday } from 'date-fns'

interface MessageListProps {
  searchQuery: string
  viewMode?: 'column' | 'row'
  onSelectEmail?: (emailId: string) => void
}

export function MessageList({ searchQuery, viewMode = 'column', onSelectEmail }: MessageListProps) {
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const { data: emails, isLoading } = useEmails(selectedMailboxId)
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const selectEmail = useMailStore((state) => state.selectEmail)
  const listRef = useRef<HTMLDivElement>(null)
  
  // Handle Enter key to open selected email
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && selectedEmailId) {
        e.preventDefault()
        onSelectEmail?.(selectedEmailId)
      }
    }
    
    // Only add listener if the list is focused or contains focus
    const listElement = listRef.current
    if (listElement) {
      listElement.addEventListener('keydown', handleKeyDown)
      return () => listElement.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedEmailId, onSelectEmail])
  
  
  // Filter and sort emails (latest first)
  const filteredEmails = useMemo(() => {
    if (!emails) return []
    
    let filtered = [...emails]
    
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(email => 
        email.subject?.toLowerCase().includes(query) ||
        email.from?.[0]?.email?.toLowerCase().includes(query) ||
        email.from?.[0]?.name?.toLowerCase().includes(query) ||
        email.preview?.toLowerCase().includes(query)
      )
    }
    
    // Sort by date, latest first
    return filtered.sort((a, b) => 
      new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
    )
  }, [emails, searchQuery])
  
  const formatEmailDate = (dateString: string): string => {
    const date = new Date(dateString)
    if (isToday(date)) return format(date, 'HH:mm')
    if (isYesterday(date)) return 'Yesterday'
    return format(date, 'MMM d')
  }
  
  const highlightText = (text: string, query: string) => {
    if (!query || !text) return text
    const parts = text.split(new RegExp(`(${query})`, 'gi'))
    return parts.map((part, i) => 
      part.toLowerCase() === query.toLowerCase() 
        ? <span key={i} className="search-highlight">{part}</span>
        : part
    )
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
  
  if (filteredEmails.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center">
          <div className="i-lucide:search-x text-4xl text-[var(--text-tertiary)] mb-3" />
          <p className="text-[var(--text-secondary)]">
            {searchQuery ? 'No messages found' : 'No messages in this mailbox'}
          </p>
          {searchQuery && (
            <p className="text-sm text-[var(--text-tertiary)] mt-1">
              Try a different search term
            </p>
          )}
        </div>
      </div>
    )
  }
  
  return (
    <div className="h-full overflow-y-auto" ref={listRef} tabIndex={0}>
      {/* Message count header */}
      <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between">
        <span className="text-sm text-[var(--text-secondary)]">
          {filteredEmails.length} {filteredEmails.length === 1 ? 'conversation' : 'conversations'}
        </span>
        <button className="p-1 hover:bg-white/10 rounded" title="Refresh">
          <div className="i-lucide:refresh-cw text-sm" />
        </button>
      </div>
      
      {/* Email list */}
      {filteredEmails.map((email) => {
        const isSelected = email.id === selectedEmailId
        const isUnread = !email.keywords.$seen
        const sender = email.from?.[0]
        const senderName = sender?.name || sender?.email?.split('@')[0] || 'Unknown'
        
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
                    {searchQuery ? highlightText(senderName, searchQuery) : senderName}
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
                  {searchQuery ? highlightText(email.subject || '(no subject)', searchQuery) : (email.subject || '(no subject)')}
                </div>
                
                {/* Preview */}
                <div className={`
                  truncate
                  ${viewMode === 'row' ? 'text-sm' : 'text-sm'}
                  ${isSelected ? 'text-white/70' : 'text-[var(--text-tertiary)]'}
                `}>
                  {searchQuery ? highlightText(email.preview, searchQuery) : email.preview}
                </div>
                
                {/* Labels/Tags */}
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
              
              {/* Row mode: Additional info */}
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
    </div>
  )
}
