import { useMailboxes } from '../../hooks'
import { useMailStore } from '../../stores/mailStore'

export function MobileBottomNav() {
  const { data: mailboxes } = useMailboxes()
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const selectMailbox = useMailStore((state) => state.selectMailbox)
  
  const mainBoxes = mailboxes?.filter(m => 
    ['inbox', 'sent', 'drafts', 'trash'].includes(m.role || '')
  ).slice(0, 4) || []
  
  const getMailboxIcon = (role: string | null): string => {
    switch (role) {
      case 'inbox': return 'i-lucide:inbox'
      case 'sent': return 'i-lucide:send'
      case 'drafts': return 'i-lucide:file-text'
      case 'trash': return 'i-lucide:trash-2'
      default: return 'i-lucide:folder'
    }
  }
  
  return (
    <nav className="flex h-14 bg-[var(--bg-secondary)] border-t border-[var(--border-color)]">
      {mainBoxes.map((mailbox) => (
        <button
          key={mailbox.id}
          onClick={() => selectMailbox(mailbox.id)}
          className={`flex-1 flex flex-col items-center justify-center gap-1 p-2 relative ${
            selectedMailboxId === mailbox.id ? 'text-[var(--primary-color)]' : 'text-[var(--text-tertiary)]'
          }`}
        >
          <div className={`text-lg ${getMailboxIcon(mailbox.role)}`} />
          <span className="text-xs">{mailbox.name}</span>
          {mailbox.unreadEmails > 0 && (
            <span className="absolute top-1 right-1/4 bg-[var(--primary-color)] text-white text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {mailbox.unreadEmails > 99 ? '99+' : mailbox.unreadEmails}
            </span>
          )}
        </button>
      ))}
    </nav>
  )
}
