import React from 'react'
import { useMailboxes } from '../../hooks/useJMAP'
import { useMailStore } from '../../stores/mailStore'
import { useAuthStore } from '../../stores/authStore'

export function Sidebar() {
  const { data: mailboxes, isLoading } = useMailboxes()
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const selectMailbox = useMailStore((state) => state.selectMailbox)
  const logout = useAuthStore((state) => state.logout)

  // Auto-select inbox
  React.useEffect(() => {
    if (!selectedMailboxId && mailboxes && mailboxes.length > 0) {
      const inbox = mailboxes.find((m) => m.role === 'inbox')
      if (inbox) {
        selectMailbox(inbox.id)
      }
    }
  }, [mailboxes, selectedMailboxId, selectMailbox])

  const getMailboxIcon = (role: string | null): string => {
    switch (role) {
      case 'inbox':
        return 'i-lucide:inbox'
      case 'sent':
        return 'i-lucide:send'
      case 'drafts':
        return 'i-lucide:file-text'
      case 'trash':
        return 'i-lucide:trash-2'
      case 'archive':
        return 'i-lucide:archive'
      case 'junk':
        return 'i-lucide:shield-x'
      default:
        return 'i-lucide:folder'
    }
  }

  const getMailboxColor = (role: string | null): string => {
    switch (role) {
      case 'inbox':
        return 'text-[var(--primary-color)]'
      case 'sent':
        return 'text-[var(--accent-cyan)]'
      case 'drafts':
        return 'text-[var(--accent-yellow)]'
      case 'trash':
        return 'text-[var(--accent-pink)]'
      case 'junk':
        return 'text-[var(--accent-orange)]'
      default:
        return 'text-[var(--accent-green)]'
    }
  }

  if (isLoading) {
    return (
      <div className="w-[var(--sidebar-width)] bg-[var(--bg-secondary)] border-r border-[var(--border-color)] p-4">
        <div className="animate-spin i-eos-icons:loading text-xl text-[var(--text-tertiary)]" />
      </div>
    )
  }

  return (
    <div className="w-[var(--sidebar-width)] bg-[var(--bg-secondary)] border-r border-[var(--border-color)] flex flex-col">
      {/* Mailboxes */}
      <div className="flex-1 overflow-y-auto py-2">
        {mailboxes?.map((mailbox) => {
          const isSelected = mailbox.id === selectedMailboxId

          return (
            <button
              key={mailbox.id}
              onClick={() => selectMailbox(mailbox.id)}
              className={`
                w-full px-4 py-2.5 flex items-center gap-3 text-left transition-all
                hover:bg-white/10
                ${isSelected ? 'bg-[var(--primary-color)]/20 text-[var(--text-primary)] border-r-4 border-[var(--primary-color)]' : 'text-[var(--text-primary)]'}
              `}
            >
              <div
                className={`${getMailboxIcon(mailbox.role)} ${isSelected ? '' : getMailboxColor(mailbox.role)}`}
              />
              <span className="flex-1 font-medium">{mailbox.name}</span>
              {mailbox.unreadEmails > 0 && (
                <span
                  className={`
                  px-2 py-0.5 rounded-full text-xs font-medium
                  ${isSelected ? 'bg-[var(--primary-color)] text-white' : 'bg-[var(--accent-cyan)] text-white'}
                `}
                >
                  {mailbox.unreadEmails > 999 ? '999+' : mailbox.unreadEmails}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Bottom section */}
      <div className="border-t border-[var(--border-color)] p-4">
        <button className="w-full flex items-center gap-3 px-3 py-2 text-[var(--text-primary)] hover:text-[var(--accent-cyan)] hover:bg-white/10 rounded transition-all">
          <div className="i-lucide:tag" />
          <span className="text-sm">Labels</span>
        </button>
        <button className="w-full flex items-center gap-3 px-3 py-2 text-[var(--text-primary)] hover:text-[var(--accent-cyan)] hover:bg-white/10 rounded transition-all">
          <div className="i-lucide:folder-plus" />
          <span className="text-sm">Folders</span>
        </button>
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2 text-[var(--text-primary)] hover:text-red-400 hover:bg-red-400/10 rounded transition-all mt-2"
        >
          <div className="i-lucide:log-out" />
          <span className="text-sm">Sign out</span>
        </button>
      </div>
    </div>
  )
}
