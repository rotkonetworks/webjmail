import React, { useState, useRef, useEffect } from 'react'
import { useMailStore } from '../../stores/mailStore'
import { useMarkAsRead, useFlagEmail, useDeleteEmail, usePrimaryAccountId } from '../../hooks/useJMAP'
import { MessageComposer } from './MessageComposer'
import DOMPurify from 'dompurify'
import { format } from 'date-fns'

interface MessageViewProps {
  onClose?: () => void
}

export function MessageView({ onClose }: MessageViewProps = {}) {
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const emails = useMailStore((state) => state.emails)
  const email = selectedEmailId ? emails[selectedEmailId] : null
  const accountId = usePrimaryAccountId()
  const selectEmail = useMailStore((state) => state.selectEmail)
  
  const markAsRead = useMarkAsRead()
  const flagEmail = useFlagEmail()
  const deleteEmail = useDeleteEmail()
  
  const [showComposer, setShowComposer] = useState(false)
  const [composerMode, setComposerMode] = useState<'reply' | 'replyAll' | 'forward'>('reply')
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set())
  
  const timelineRef = useRef<HTMLDivElement>(null)
  const emailRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  
  // Mark as read
  useEffect(() => {
    if (email && !email.keywords.$seen && accountId) {
      markAsRead.mutate({ emailId: email.id, isRead: true })
    }
  }, [email?.id])
  
  // Get all emails in thread (mock data for now - in real app would fetch thread)
  const threadEmails = email ? [email] : []
  
  // Expand latest email by default
  useEffect(() => {
    if (email && threadEmails.length > 0) {
      setExpandedEmails(new Set([threadEmails[0].id]))
    }
  }, [email?.id])
  
  if (!email || !accountId) return null
  
  const handleReply = (mode: 'reply' | 'replyAll' | 'forward') => {
    setComposerMode(mode)
    setShowComposer(true)
  }
  
  const handleDelete = () => {
    if (confirm('Delete this message?')) {
      deleteEmail.mutate({ accountId, emailId: email.id })
      selectEmail(null)
      onClose?.()
    }
  }
  
  const handleFlag = () => {
    flagEmail.mutate({ 
      accountId, 
      emailId: email.id, 
      isFlagged: !email.keywords.$flagged 
    })
  }
  
  const toggleEmailExpansion = (emailId: string) => {
    setExpandedEmails(prev => {
      const next = new Set(prev)
      if (next.has(emailId)) {
        next.delete(emailId)
      } else {
        next.add(emailId)
      }
      return next
    })
  }
  
  const scrollToEmail = (emailId: string) => {
    const element = emailRefs.current.get(emailId)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  
  const renderEmailContent = (email: any) => {
    const htmlBody = email.htmlBody?.[0]
    const textBody = email.textBody?.[0]
    const bodyValue = htmlBody 
      ? email.bodyValues[htmlBody.partId]
      : textBody 
      ? email.bodyValues[textBody.partId]
      : null
      
    if (!bodyValue) return null
    
    if (htmlBody) {
      return (
        <div 
          className="prose prose-invert max-w-none"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(bodyValue.value, {
              ALLOWED_TAGS: ['p', 'br', 'div', 'span', 'a', 'b', 'i', 'em', 'strong', 'u', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'pre', 'code'],
              ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'style', 'target'],
            })
          }}
        />
      )
    }
    
    return <pre className="whitespace-pre-wrap font-sans text-[var(--text-primary)]">{bodyValue.value}</pre>
  }
  
  return (
    <>
      <div className="h-full flex">
        {/* Main content */}
        <div className="flex-1 flex flex-col">
          {/* Action bar */}
          <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  selectEmail(null)
                  onClose?.()
                }}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title="Back"
              >
                <div className="i-lucide:arrow-left" />
              </button>
              
              <h2 className="text-lg font-medium text-[var(--text-primary)] ml-2">
                {email.subject || '(no subject)'}
              </h2>
            </div>
            
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleReply('reply')}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title="Reply"
              >
                <div className="i-lucide:reply" />
              </button>
              <button
                onClick={() => handleReply('replyAll')}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title="Reply All"
              >
                <div className="i-lucide:reply-all" />
              </button>
              <button
                onClick={() => handleReply('forward')}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title="Forward"
              >
                <div className="i-lucide:forward" />
              </button>
              <div className="w-px h-6 bg-[var(--border-color)] mx-1" />
              <button
                onClick={handleFlag}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title={email.keywords.$flagged ? 'Unflag' : 'Flag'}
              >
                <div className={`${email.keywords.$flagged ? 'i-lucide:star-fill text-[var(--accent-pink)]' : 'i-lucide:star'}`} />
              </button>
              <button
                onClick={handleDelete}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title="Delete"
              >
                <div className="i-lucide:trash-2" />
              </button>
            </div>
          </div>
          
          {/* Email thread */}
          <div className="flex-1 overflow-y-auto timeline-scrollbar" ref={timelineRef}>
            <div className="email-timeline max-w-4xl mx-auto p-6">
              {threadEmails.map((threadEmail, index) => {
                const isExpanded = expandedEmails.has(threadEmail.id)
                const sender = threadEmail.from?.[0]
                const isLatest = index === 0
                
                return (
                  <div
                    key={threadEmail.id}
                    ref={(el) => el && emailRefs.current.set(threadEmail.id, el)}
                    className={`timeline-marker mb-6 ${isLatest ? 'slide-in' : ''}`}
                  >
                    {/* Email header */}
                    <div
                      onClick={() => toggleEmailExpansion(threadEmail.id)}
                      className="bg-[var(--bg-secondary)] rounded-lg p-4 cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          <div className="w-10 h-10 bg-[var(--proton-purple)] rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0">
                            {(sender?.name || sender?.email || 'U').charAt(0).toUpperCase()}
                          </div>
                          
                          {/* Sender info */}
                          <div>
                            <div className="font-medium text-[var(--text-primary)]">
                              {sender?.name || sender?.email || 'Unknown'}
                            </div>
                            <div className="text-sm text-[var(--text-tertiary)]">
                              {sender?.email}
                            </div>
                          </div>
                        </div>
                        
                        {/* Time and expand icon */}
                        <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
                          <span>{format(new Date(threadEmail.receivedAt), 'MMM d, yyyy at HH:mm')}</span>
                          <div className={`i-lucide:chevron-down transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </div>
                      
                      {/* Preview when collapsed */}
                      {!isExpanded && (
                        <p className="mt-2 text-sm text-[var(--text-tertiary)] truncate">
                          {threadEmail.preview}
                        </p>
                      )}
                    </div>
                    
                    {/* Email content when expanded */}
                    {isExpanded && (
                      <div className="mt-4 bg-[var(--bg-secondary)] rounded-lg p-6">
                        {renderEmailContent(threadEmail)}
                        
                        {/* Attachments */}
                        {threadEmail.attachments && threadEmail.attachments.length > 0 && (
                          <div className="mt-6 pt-6 border-t border-[var(--border-color)]">
                            <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
                              Attachments ({threadEmail.attachments.length})
                            </h4>
                            <div className="grid grid-cols-2 gap-2">
                              {threadEmail.attachments.map((attachment: any) => (
                                <div 
                                  key={attachment.partId}
                                  className="flex items-center gap-2 p-3 bg-[var(--bg-tertiary)] rounded hover:bg-white/10 cursor-pointer transition-colors"
                                >
                                  <div className="i-lucide:paperclip text-[var(--text-tertiary)]" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm truncate">{attachment.name || 'Untitled'}</p>
                                    <p className="text-xs text-[var(--text-tertiary)]">
                                      {Math.round(attachment.size / 1024)} KB
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        
        {/* Timeline navigation bar */}
        {threadEmails.length > 1 && (
          <div className="w-16 bg-[var(--bg-secondary)] border-l border-[var(--border-color)] p-2">
            <div className="text-xs text-[var(--text-tertiary)] text-center mb-2">Timeline</div>
            <div className="relative h-full">
              {threadEmails.map((threadEmail, index) => {
                const position = (index / (threadEmails.length - 1)) * 100
                const date = new Date(threadEmail.receivedAt)
                
                return (
                  <button
                    key={threadEmail.id}
                    onClick={() => scrollToEmail(threadEmail.id)}
                    className="absolute left-1/2 -translate-x-1/2 group"
                    style={{ top: `${position}%` }}
                    title={format(date, 'MMM d, HH:mm')}
                  >
                    <div className="w-3 h-3 bg-[var(--proton-purple)] rounded-full group-hover:scale-150 transition-transform" />
                    <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-xs bg-black/80 px-2 py-1 rounded">
                      {format(date, 'MMM d')}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
      
      {showComposer && (
        <MessageComposer
          onClose={() => setShowComposer(false)}
          replyTo={{
            emailId: email.id,
            subject: email.subject,
            from: email.from || [],
            to: email.to || [],
            cc: email.cc,
          }}
          mode={composerMode}
        />
      )}
    </>
  )
}
