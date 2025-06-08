import React from 'react'

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
        px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors
        hover:bg-gray-50 relative
        ${isSelected ? 'bg-blue-50 border-l-4 border-l-primary' : ''}
        ${isUnread ? 'font-semibold' : ''}
      `}
      onClick={onClick}
    >
      {/* Unread indicator */}
      {isUnread && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 bg-primary rounded-full" />
      )}
      
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Sender and Time */}
          <div className="flex items-center justify-between mb-1">
            <span className={`text-sm truncate ${isUnread ? 'text-gray-900' : 'text-gray-700'}`}>
              {senderName}
            </span>
            <span className={`text-xs flex-shrink-0 ${isUnread ? 'text-primary' : 'text-gray-500'}`}>
              {formatDate(email.receivedAt)}
            </span>
          </div>
          
          {/* Subject */}
          <div className={`text-sm mb-1 truncate ${isUnread ? 'text-gray-900' : 'text-gray-800'}`}>
            {email.subject || '(no subject)'}
          </div>
          
          {/* Preview */}
          <div className="text-sm text-gray-600 truncate">
            {email.preview}
          </div>
        </div>
        
        {/* Icons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {email.hasAttachment && (
            <div className="i-lucide:paperclip text-gray-400 text-sm" title="Has attachment" />
          )}
          {isFlagged && (
            <div className="i-lucide:star-fill text-yellow-500 text-sm" title="Flagged" />
          )}
        </div>
      </div>
    </div>
  )
}
