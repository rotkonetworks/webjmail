import React, { useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useSendEmail } from '../../hooks/useJMAP'

interface MessageComposerProps {
  onClose: () => void
  replyTo?: {
    emailId: string
    subject: string
    from: Array<{ name: string | null; email: string }>
    to: Array<{ name: string | null; email: string }>
    cc?: Array<{ name: string | null; email: string }>
  }
  mode?: 'compose' | 'reply' | 'replyAll' | 'forward'
}

export function MessageComposer({ onClose, replyTo, mode = 'compose' }: MessageComposerProps) {
  const session = useAuthStore((state) => state.session)
  const sendEmail = useSendEmail()
  
  const [to, setTo] = useState(
    mode === 'reply' && replyTo ? replyTo.from.map(a => a.email).join(', ') :
    mode === 'replyAll' && replyTo ? 
      [...replyTo.from, ...replyTo.to.filter(a => a.email !== session?.username)]
        .map(a => a.email).join(', ') : ''
  )
  const [cc, setCc] = useState(
    mode === 'replyAll' && replyTo?.cc ? replyTo.cc.map(a => a.email).join(', ') : ''
  )
  const [subject, setSubject] = useState(
    replyTo ? 
      (mode === 'forward' ? `Fwd: ${replyTo.subject}` : 
       replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`) 
    : ''
  )
  const [body, setBody] = useState('')
  const [isSending, setIsSending] = useState(false)
  
  const handleSend = async () => {
    if (!to.trim()) {
      alert('Please enter at least one recipient')
      return
    }
    
    setIsSending(true)
    try {
      await sendEmail.mutateAsync({
        to: to.split(',').map(email => ({ email: email.trim() })),
        cc: cc ? cc.split(',').map(email => ({ email: email.trim() })) : undefined,
        subject,
        textBody: body,
        inReplyTo: mode === 'reply' || mode === 'replyAll' ? replyTo?.emailId : undefined,
      })
      onClose()
    } catch (error) {
      console.error('Failed to send email:', error)
      alert('Failed to send email. Please try again.')
    } finally {
      setIsSending(false)
    }
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-secondary)] rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-[var(--border-color)]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {mode === 'compose' ? 'New Message' :
             mode === 'reply' ? 'Reply' :
             mode === 'replyAll' ? 'Reply All' : 'Forward'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
          >
            <div className="i-lucide:x text-[var(--text-secondary)]" />
          </button>
        </div>
        
        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
              To
            </label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="search-input w-full"
              placeholder="recipient@example.com, another@example.com"
              disabled={isSending}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
              Cc
            </label>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              className="search-input w-full"
              placeholder="cc@example.com"
              disabled={isSending}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="search-input w-full"
              placeholder="Email subject"
              disabled={isSending}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="search-input w-full h-64 resize-none"
              placeholder="Type your message here..."
              disabled={isSending}
            />
          </div>
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <button
              className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
              title="Attach file"
              disabled={isSending}
            >
              <div className="i-lucide:paperclip text-[var(--text-secondary)]" />
            </button>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
              disabled={isSending}
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              className="btn-primary px-4 py-2 rounded-lg flex items-center"
              disabled={isSending || !to.trim()}
            >
              {isSending ? (
                <>
                  <div className="i-eos-icons:loading animate-spin mr-2" />
                  Sending...
                </>
              ) : (
                <>
                  <div className="i-lucide:send mr-2" />
                  Send
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
