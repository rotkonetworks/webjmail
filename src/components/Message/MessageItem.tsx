
interface Email {
  id: string
  subject: string
  from: Array<{ name: string | null; email: string }> | null
  preview: string
  receivedAt: string
  keywords: Record<string, boolean>
  hasAttachment: boolean
}

interface MessageItemProps {
  email: Email
  isSelected: boolean
  onClick: () => void
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    // Today - show time
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else if (days === 1) {
    return 'Yesterday'
  } else if (days < 7) {
    // This week - show day name
    return date.toLocaleDateString([], { weekday: 'short' })
  } else if (date.getFullYear() === now.getFullYear()) {
    // This year - show month and day
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } else {
    // Different year - show full date
    return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
  }
}

export function MessageItem({ email, isSelected, onClick }: MessageItemProps) {
  const isUnread = !email.keywords.$seen
  const isFlagged = email.keywords.$flagged
  const sender = email.from?.[0]
  const senderName = sender?.name || sender?.email || 'Unknown'

  return (
    <div
      className={`
        email-item px-4 py-3 sm:py-2 border-b border-[var(--border-color)] cursor-pointer transition-colors
        hover:bg-[var(--bg-tertiary)] relative touch-friendly
        ${isSelected ? 'bg-[var(--bg-tertiary)] border-l-4 border-l-[var(--primary-color)]' : ''}
        ${isUnread ? 'font-semibold' : ''}
      `}
      onClick={onClick}
    >
      {/* Unread indicator */}
      {isUnread && (
        <div className="unread-dot absolute left-2 top-1/2 -translate-y-1/2" />
      )}

      <div className="flex items-start justify-between gap-3 md:gap-2">
        <div className="flex-1 min-w-0">
          {/* Sender and Time */}
          <div className="flex items-center justify-between mb-1">
            <span className={`text-sm md:text-sm truncate ${isUnread ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
              {senderName}
            </span>
            <span
              className={`text-xs flex-shrink-0 ${isUnread ? 'text-[var(--primary-color)]' : 'text-[var(--text-tertiary)]'}`}
            >
              {formatDate(email.receivedAt)}
            </span>
          </div>

          {/* Subject */}
          <div className={`text-sm md:text-sm mb-1 truncate ${isUnread ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
            {email.subject || '(no subject)'}
          </div>

          {/* Preview */}
          <div className="text-sm text-[var(--text-tertiary)] truncate">{email.preview}</div>
        </div>

        {/* Icons */}
        <div className="flex items-center gap-2 md:gap-1 flex-shrink-0">
          {email.hasAttachment && (
            <div className="i-lucide:paperclip text-[var(--text-tertiary)] text-base md:text-sm" title="Has attachment" />
          )}
          {isFlagged && (
            <div className="i-lucide:star-fill text-[var(--accent-yellow)] text-base md:text-sm" title="Flagged" />
          )}
        </div>
      </div>
    </div>
  )
}
