import React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAuthStore } from '../../stores/authStore'
import { useMailStore } from '../../stores/mailStore'
import { useEmails } from '../../hooks/useJMAP'
import { MessageItem } from './MessageItem'

export function MessageList() {
  const parentRef = React.useRef<HTMLDivElement>(null)
  const session = useAuthStore((state) => state.session)
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const selectEmail = useMailStore((state) => state.selectEmail)
  
  const primaryAccountId = session?.primaryAccounts['urn:ietf:params:jmap:mail']
  const { data: emails, isLoading } = useEmails(
    primaryAccountId || '',
    selectedMailboxId
  )

  const virtualizer = useVirtualizer({
    count: emails?.length || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 5,
  })

  if (!selectedMailboxId) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        Select a mailbox
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="i-eos-icons:loading animate-spin text-2xl" />
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
          const email = emails![virtualItem.index]
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
