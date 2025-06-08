import React from 'react'
import { useMailStore } from '../../stores/mailStore'
import { useMailboxes } from '../../hooks/useJMAP'
import { MailboxItem } from './MailboxItem'

export function MailboxList() {
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const selectMailbox = useMailStore((state) => state.selectMailbox)
  
  const { data: mailboxes, isLoading, error } = useMailboxes()

  if (isLoading) {
    return (
      <div className="p-4 text-center">
        <div className="i-eos-icons:loading animate-spin text-xl text-gray-500" />
        <p className="mt-2 text-sm text-gray-500">Loading mailboxes...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <div className="i-lucide:alert-circle text-red-500 text-xl" />
        <p className="mt-2 text-sm text-red-600">Failed to load mailboxes</p>
        <p className="text-xs text-gray-500 mt-1">{error.message}</p>
      </div>
    )
  }

  if (!mailboxes || mailboxes.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-gray-500">
        No mailboxes found
      </div>
    )
  }

  const rootMailboxes = mailboxes.filter((m) => !m.parentId)
  const childrenByParent = mailboxes.reduce((acc, m) => {
    if (m.parentId) {
      if (!acc[m.parentId]) acc[m.parentId] = []
      acc[m.parentId].push(m)
    }
    return acc
  }, {} as Record<string, typeof mailboxes>)

  return (
    <div className="flex-1 overflow-y-auto">
      {rootMailboxes.map((mailbox) => (
        <MailboxItem
          key={mailbox.id}
          mailbox={mailbox}
          children={childrenByParent[mailbox.id] || []}
          childrenByParent={childrenByParent}
          isSelected={mailbox.id === selectedMailboxId}
          onSelect={() => selectMailbox(mailbox.id)}
          depth={0}
        />
      ))}
    </div>
  )
}
