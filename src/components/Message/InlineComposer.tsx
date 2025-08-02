// src/components/Message/InlineComposer.tsx
import { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useSendEmail } from '../../hooks'
import { config } from '../../config'

interface InlineComposerProps {
  onClose: () => void
  onMinimize?: () => void
  isMinimized?: boolean
  replyTo?: {
    emailId: string
    subject: string
    from: Array<{ name: string | null; email: string }>
    to: Array<{ name: string | null; email: string }>
    cc?: Array<{ name: string | null; email: string }>
  }
  mode?: 'compose' | 'reply' | 'replyAll' | 'forward'
  isMobile?: boolean
}

export function InlineComposer({ 
  onClose, 
  onMinimize, 
  isMinimized = false,
  replyTo, 
  mode = 'compose',
  isMobile = false 
}: InlineComposerProps) {
  const session = useAuthStore((state) => state.session)
  const sendEmail = useSendEmail()
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  
  const [to, setTo] = useState(
    mode === 'reply' && replyTo
      ? replyTo.from.map((a) => a.email).join(', ')
      : mode === 'replyAll' && replyTo
        ? [...replyTo.from, ...replyTo.to.filter((a) => a.email !== session?.username)]
            .map((a) => a.email)
            .join(', ')
        : ''
  )
  
  const [cc, setCc] = useState(
    mode === 'replyAll' && replyTo?.cc ? replyTo.cc.map((a) => a.email).join(', ') : ''
  )
  
  const [subject, setSubject] = useState(
    replyTo
      ? mode === 'forward'
        ? `Fwd: ${replyTo.subject}`
        : replyTo.subject.startsWith('Re:')
          ? replyTo.subject
          : `Re: ${replyTo.subject}`
      : ''
  )
  
  const [body, setBody] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showCc, setShowCc] = useState(!!cc)
  const [showBcc, setShowBcc] = useState(false)
  const [bcc, setBcc] = useState('')
  
  // Auto-focus body on mount
  useEffect(() => {
    if (!isMinimized && bodyRef.current) {
      bodyRef.current.focus()
    }
  }, [isMinimized])
  
  const handleSend = async () => {
    const validateEmail = (email: string): boolean => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return emailRegex.test(email) && email.length <= 254
    }
    
    const validateEmailList = (emailList: string): string[] => {
      const emails = emailList.split(',').map(e => e.trim()).filter(e => e.length > 0)
      const invalid = emails.filter(email => !validateEmail(email))
      if (invalid.length > 0) {
        throw new Error(`Invalid email addresses: ${invalid.join(', ')}`)
      }
      return emails
    }
    
    try {
      if (!to.trim()) {
        alert('Please enter at least one recipient')
        return
      }
      
      const toEmails = validateEmailList(to)
      const ccEmails = cc ? validateEmailList(cc) : []
      const bccEmails = bcc ? validateEmailList(bcc) : []
      
      if (toEmails.length + ccEmails.length + bccEmails.length > 100) {
        alert('Too many recipients (limit: 100)')
        return
      }
      
      if (subject.length > config.security.maxSubjectLength) {
        alert(`Subject too long (limit: ${config.security.maxSubjectLength} characters)`)
        return
      }
      
      const estimatedSize = new Blob([body]).size
      if (estimatedSize > config.email.maxAttachmentSizeMB * 1024 * 1024) {
        alert(`Email body too large (limit: ${config.email.maxAttachmentSizeMB}MB)`)
        return
      }
      
      setIsSending(true)
      
      await sendEmail.mutateAsync({
        to: toEmails.map((email) => ({ email })),
        cc: ccEmails.length > 0 ? ccEmails.map((email) => ({ email })) : undefined,
        bcc: bccEmails.length > 0 ? bccEmails.map((email) => ({ email })) : undefined,
        subject: subject.trim(),
        textBody: body,
        inReplyTo: mode === 'reply' || mode === 'replyAll' ? replyTo?.emailId : undefined,
      })
      
      onClose()
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to send email:', error)
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to send email. Please try again.'
      alert(errorMessage)
    } finally {
      setIsSending(false)
    }
  }
  
  if (isMinimized) {
    return (
      <div className={`fixed bottom-0 ${isMobile ? 'left-2 right-2' : 'right-4 w-80'} bg-[var(--bg-secondary)] rounded-t-lg shadow-lg border border-[var(--border-color)]`}>
        <div className="flex items-center justify-between p-3 cursor-pointer" onClick={onMinimize}>
          <div className="flex items-center gap-2">
            <div className="i-lucide:edit-3 text-[var(--text-secondary)]" />
            <span className="text-sm font-medium truncate">
              {mode === 'compose' ? 'New Message' : subject}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onMinimize?.()
              }}
              className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
            >
              <div className="i-lucide:maximize-2 text-sm" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose()
              }}
              className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
            >
              <div className="i-lucide:x text-sm" />
            </button>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className={`fixed bottom-0 ${isMobile ? 'left-2 right-2' : 'right-4 w-[500px]'} bg-[var(--bg-secondary)] rounded-t-lg shadow-2xl border border-[var(--border-color)] max-h-[80vh] flex flex-col`}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--border-color)]">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {mode === 'compose'
            ? 'New Message'
            : mode === 'reply'
              ? 'Reply'
              : mode === 'replyAll'
                ? 'Reply All'
                : 'Forward'}
        </h3>
        <div className="flex items-center gap-1">
          {onMinimize && (
            <button
              onClick={onMinimize}
              className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
              title="Minimize"
            >
              <div className="i-lucide:minimize-2 text-sm" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
            title="Close"
          >
            <div className="i-lucide:x text-sm" />
          </button>
        </div>
      </div>
      
      {/* Form */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* To field */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-[var(--text-secondary)] w-12">To:</label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="flex-1 text-sm bg-transparent border-b border-[var(--border-color)] focus:border-[var(--primary-color)] outline-none py-1"
              placeholder="recipient@example.com"
              disabled={isSending}
            />
            <button
              onClick={() => setShowCc(!showCc)}
              className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              Cc
            </button>
            <button
              onClick={() => setShowBcc(!showBcc)}
              className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              Bcc
            </button>
          </div>
        </div>
        
        {/* Cc field */}
        {showCc && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-[var(--text-secondary)] w-12">Cc:</label>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              className="flex-1 text-sm bg-transparent border-b border-[var(--border-color)] focus:border-[var(--primary-color)] outline-none py-1"
              placeholder="cc@example.com"
              disabled={isSending}
            />
          </div>
        )}
        
        {/* Bcc field */}
        {showBcc && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-[var(--text-secondary)] w-12">Bcc:</label>
            <input
              type="text"
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              className="flex-1 text-sm bg-transparent border-b border-[var(--border-color)] focus:border-[var(--primary-color)] outline-none py-1"
              placeholder="bcc@example.com"
              disabled={isSending}
            />
          </div>
        )}
        
        {/* Subject */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-[var(--text-secondary)] w-12">Subject:</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="flex-1 text-sm bg-transparent border-b border-[var(--border-color)] focus:border-[var(--primary-color)] outline-none py-1"
            placeholder="Email subject"
            disabled={isSending}
          />
        </div>
        
        {/* Body */}
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full min-h-[200px] text-sm bg-transparent resize-none outline-none"
          placeholder="Type your message here..."
          disabled={isSending}
        />
      </div>
      
      {/* Footer */}
      <div className="flex items-center justify-between p-3 border-t border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <button
            className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded"
            title="Attach file"
            disabled={isSending}
          >
            <div className="i-lucide:paperclip text-sm" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            disabled={isSending}
          >
            Discard
          </button>
          <button
            onClick={handleSend}
            className="btn-primary px-4 py-1.5 text-xs rounded flex items-center"
            disabled={isSending || !to.trim()}
          >
            {isSending ? (
              <>
                <div className="i-eos-icons:loading animate-spin mr-1.5 text-xs" />
                Sending...
              </>
            ) : (
              <>
                <div className="i-lucide:send mr-1.5 text-xs" />
                Send
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
