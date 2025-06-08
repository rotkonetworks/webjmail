import React, { useEffect, useRef } from 'react'
import { useEmails } from '../../hooks/useJMAP'
import { useMailStore } from '../../stores/mailStore'
import { format } from 'date-fns'

interface Props {
  onSelect: () => void
}

export function MessageList({ onSelect }: Props) {
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const { data: emails, isLoading } = useEmails(selectedMailboxId)
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const selectEmail = useMailStore((state) => state.selectEmail)
  const [focusIndex, setFocusIndex] = React.useState(0)
  const itemsRef = useRef<(HTMLDivElement | null)[]>([])
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!emails?.length) return
      
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          setFocusIndex(i => Math.min(i + 1, emails.length - 1))
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          setFocusIndex(i => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          selectEmail(emails[focusIndex].id)
          onSelect()
          break
        case 'd':
          // Delete/archive
          break
        case 'r':
          // Mark as read/unread
          break
        case 's':
          // Star/flag
          break
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [emails, focusIndex, selectEmail, onSelect])
  
  // Scroll focused item into view
  useEffect(() => {
    itemsRef.current[focusIndex]?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])
  
  if (isLoading) {
    return <div className="p-4 text-bright-black">Loading messages...</div>
  }
  
  if (!emails?.length) {
    return <div className="p-4 text-bright-black">No messages</div>
  }
  
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-bright-black p-2 text-bright-black flex justify-between">
        <span>MESSAGES</span>
        <span>{emails.length} total</span>
      </div>
      {emails.map((email, index) => {
        const isUnread = !email.keywords.$seen
        const isFlagged = email.keywords.$flagged
        const sender = email.from?.[0]
        const date = new Date(email.receivedAt)
        const isToday = date.toDateString() === new Date().toDateString()
        
        return (
          <div
            key={email.id}
            ref={el => itemsRef.current[index] = el}
            className={`
              px-4 py-1 cursor-pointer border-b border-bright-black
              ${index === focusIndex ? 'bg-bright-black' : ''}
              ${email.id === selectedEmailId ? 'text-primary' : ''}
              hover:bg-bright-black
            `}
            onClick={() => {
              selectEmail(email.id)
              onSelect()
            }}
          >
            <div className="flex items-center gap-2">
              <span className="w-4 text-center">
                {isUnread && <span className="text-cyan">●</span>}
              </span>
              <span className="w-4 text-center">
                {isFlagged && <span className="text-yellow">★</span>}
              </span>
              <span className="w-32 truncate text-green">
                {sender?.name || sender?.email || 'Unknown'}
              </span>
              <span className="flex-1 truncate">
                {email.subject || '(no subject)'}
              </span>
              <span className="text-bright-black">
                {isToday ? format(date, 'HH:mm') : format(date, 'MM/dd')}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
