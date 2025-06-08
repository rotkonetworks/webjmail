import React from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useMailStore } from '../../stores/mailStore'

interface Props {
  mode: string
}

export function StatusBar({ mode }: Props) {
  const session = useAuthStore((state) => state.session)
  const mailboxes = useMailStore((state) => state.mailboxes)
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const emails = useMailStore((state) => state.emails)
  
  const currentMailbox = selectedMailboxId ? mailboxes[selectedMailboxId] : null
  const emailCount = Object.keys(emails).length
  
  return (
    <div className="status-bar px-4 py-1 flex items-center justify-between text-xs">
      <div className="flex items-center gap-4">
        <span className="text-primary">[{mode}]</span>
        {currentMailbox && (
          <span className="text-green">{currentMailbox.name}</span>
        )}
        {emailCount > 0 && (
          <span className="text-cyan">{emailCount} messages</span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-yellow">{session?.username}</span>
        <span className="text-bright-black">
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}
