import React from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useMailStore } from '../../stores/mailStore'
import { useMailboxes } from '../../hooks/useJMAP'
import { MailboxItem } from './MailboxItem'

export function MailboxList() {
  const session = useAuthStore((state) => state.session)
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const selectMailbox = useMailStore((state) => state.selectMailbox)
  
  const primaryAccountId = session?.primaryAccounts['urn:ietf:params:jmap:mail']
  const { data: mailboxes, isLoading } = useMailboxes(primaryAccountId || '')

  if (isLoading) {
    return <div className="p-4">Loading mailboxes...</div>
  }

  const rootMailboxes = mailboxes?.filter((m) => !m.parentId) || []
  const childrenByParent = mailboxes?.reduce((acc, m) => {
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
          children={childrenByParent?.[mailbox.id] || []}
          childrenByParent={childrenByParent || {}}
          isSelected={mailbox.id === selectedMailboxId}
          onSelect={() => selectMailbox(mailbox.id)}
          depth={0}
        />
      ))}
    </div>
  )
}
