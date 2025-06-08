import React, { useEffect, useRef } from 'react'
import { useMailboxes } from '../../hooks/useJMAP'
import { useMailStore } from '../../stores/mailStore'
import { Mailbox } from '../../api/types'

interface Props {
  onSelect: () => void
}

export function MailboxList({ onSelect }: Props) {
  const { data: mailboxes, isLoading } = useMailboxes()
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const selectMailbox = useMailStore((state) => state.selectMailbox)
  const [focusIndex, setFocusIndex] = React.useState(0)
  const itemsRef = useRef<(HTMLDivElement | null)[]>([])
  
  const flatMailboxes = React.useMemo(() => {
    if (!mailboxes) return []
    return mailboxes.sort((a, b) => {
      // Prioritize special folders
      const roleOrder = { inbox: 0, sent: 1, drafts: 2, trash: 3, junk: 4 }
      const aOrder = a.role ? roleOrder[a.role as keyof typeof roleOrder] ?? 99 : 99
      const bOrder = b.role ? roleOrder[b.role as keyof typeof roleOrder] ?? 99 : 99
      return aOrder - bOrder || a.name.localeCompare(b.name)
    })
  }, [mailboxes])
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!flatMailboxes.length) return
      
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          setFocusIndex(i => Math.min(i + 1, flatMailboxes.length - 1))
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          setFocusIndex(i => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          selectMailbox(flatMailboxes[focusIndex].id)
          onSelect()
          break
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flatMailboxes, focusIndex, selectMailbox, onSelect])
  
  // Scroll focused item into view
  useEffect(() => {
    itemsRef.current[focusIndex]?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])
  
  if (isLoading) {
    return <div className="p-4 text-bright-black">Loading mailboxes...</div>
  }
  
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-bright-black p-2 text-bright-black">
        MAILBOXES
      </div>
      {flatMailboxes.map((mailbox, index) => (
        <div
          key={mailbox.id}
          ref={el => itemsRef.current[index] = el}
          className={`
            px-4 py-1 cursor-pointer flex items-center justify-between
            ${index === focusIndex ? 'bg-bright-black' : ''}
            ${mailbox.id === selectedMailboxId ? 'text-primary' : ''}
            hover:bg-bright-black
          `}
          onClick={() => {
            selectMailbox(mailbox.id)
            onSelect()
          }}
        >
          <span className="flex items-center gap-2">
            <span className="text-bright-black">
              {mailbox.role === 'inbox' ? '»' : ' '}
            </span>
            <span>{mailbox.name}</span>
          </span>
          {mailbox.unreadEmails > 0 && (
            <span className="text-cyan">
              [{mailbox.unreadEmails}]
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
