import React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMailStore } from '../../stores/mailStore'
import { useEmails } from '../../hooks/useJMAP'
import { MessageItem } from './MessageItem'

export function MessageList() {
  const parentRef = React.useRef<HTMLDivElement>(null)
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const selectEmail = useMailStore((state) => state.selectEmail)
  
  const { data: emails, isLoading, error } = useEmails(selectedMailboxId)

  const virtualizer = useVirtualizer({
    count: emails?.length || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 5,
  })

  if (!selectedMailboxId) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="i-lucide:inbox text-4xl mb-2" />
          <p>Select a mailbox to view messages</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="i-eos-icons:loading animate-spin text-3xl text-primary" />
          <p className="mt-2 text-sm text-gray-500">Loading messages...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="i-lucide:alert-circle text-red-500 text-3xl" />
          <p className="mt-2 text-sm text-red-600">Failed to load messages</p>
          <p className="text-xs text-gray-500 mt-1">{error.message}</p>
        </div>
      </div>
    )
  }

  if (!emails || emails.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="i-lucide:mail text-4xl mb-2" />
          <p>No messages in this mailbox</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      <div
        className="relative"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const email = emails[virtualItem.index]
          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <MessageItem
                email={email}
                isSelected={email.id === selectedEmailId}
                onClick={() => selectEmail(email.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
