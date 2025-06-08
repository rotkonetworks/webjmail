import React, { useEffect } from 'react'
import { useMailStore } from '../../stores/mailStore'
import { format } from 'date-fns'
import DOMPurify from 'dompurify'

interface Props {
  onClose: () => void
}

export function MessageView({ onClose }: Props) {
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const emails = useMailStore((state) => state.emails)
  const email = selectedEmailId ? emails[selectedEmailId] : null
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'q' || e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
  
  if (!email) return null
  
  const htmlBody = email.htmlBody?.[0]
  const textBody = email.textBody?.[0]
  const bodyValue = htmlBody 
    ? email.bodyValues[htmlBody.partId]
    : textBody 
    ? email.bodyValues[textBody.partId]
    : null
    
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-bright-black p-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-bright-black">From:</span>
          <span className="text-green">
            {email.from?.[0]?.name || email.from?.[0]?.email}
          </span>
        </div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-bright-black">Date:</span>
          <span>{format(new Date(email.receivedAt), 'PPpp')}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-bright-black">Subject:</span>
          <span className="text-cyan">{email.subject}</span>
        </div>
      </div>
      
      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {bodyValue && (
          <div className="whitespace-pre-wrap font-mono text-sm">
            {htmlBody ? (
              <div 
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(bodyValue.value, {
                    ALLOWED_TAGS: ['p', 'br', 'a', 'b', 'i', 'em', 'strong'],
                    ALLOWED_ATTR: ['href'],
                  })
                }}
              />
            ) : (
              <pre>{bodyValue.value}</pre>
            )}
          </div>
        )}
      </div>
      
      {/* Actions */}
      <div className="border-t border-bright-black p-2 text-bright-black text-sm">
        [r]eply [a]rchive [d]elete [f]orward [q]uit
      </div>
    </div>
  )
}
