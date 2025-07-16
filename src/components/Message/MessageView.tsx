// src/components/Message/MessageView.tsx
import React, { useState, useRef, useEffect } from 'react'
import { useMailStore } from '../../stores/mailStore'
import {
  useMarkAsRead,
  useFlagEmail,
  useDeleteEmail,
  usePrimaryAccountId,
  useEmailThread,
} from '../../hooks/useJMAP'
import { MessageComposer } from './MessageComposer'
import DOMPurify from 'dompurify'
import { format } from 'date-fns'
import { jmapClient } from '../../api/jmap'

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

  // Fetch thread emails
  const { data: threadEmails } = useEmailThread(email?.threadId || null)

  // Mark as read
  useEffect(() => {
    if (email && !email.keywords.$seen && accountId) {
      markAsRead.mutate({ emailId: email.id, isRead: true })
    }
  }, [email?.id])

  // Expand latest email by default
  useEffect(() => {
    if (email && threadEmails && threadEmails.length > 0) {
      // Sort thread emails by receivedAt (newest first) and expand the newest one
      const sortedThreadEmails = [...threadEmails].sort(
        (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
      )
      const newestEmail = sortedThreadEmails[0]

      setExpandedEmails(new Set([newestEmail.id]))
      // Scroll to newest email after render
      setTimeout(() => {
        const element = emailRefs.current.get(newestEmail.id)
        element?.scrollIntoView({ behavior: 'auto', block: 'start' })
      }, 50)
    }
  }, [email?.id, threadEmails])

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
      isFlagged: !email.keywords.$flagged,
    })
  }

  const toggleEmailExpansion = (emailId: string) => {
    setExpandedEmails((prev) => {
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
    element?.scrollIntoView({ behavior: 'auto', block: 'start' })
  }

  const handleDownloadAttachment = (attachment: any) => {
    if (!accountId || !attachment.blobId) return

    const url = jmapClient.getBlobUrl(
      accountId,
      attachment.blobId,
      attachment.type || 'application/octet-stream',
      attachment.name || 'attachment'
    )

    // Create download link with auth header
    const link = document.createElement('a')
    link.href = url
    link.download = attachment.name || 'attachment'
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const getAttachmentIcon = (type: string) => {
    if (type.startsWith('image/')) return 'i-lucide:image'
    if (type.startsWith('video/')) return 'i-lucide:video'
    if (type.includes('pdf')) return 'i-lucide:file-text'
    if (type.includes('zip') || type.includes('archive')) return 'i-lucide:archive'
    if (type.includes('sheet') || type.includes('excel')) return 'i-lucide:table'
    if (type.includes('doc') || type.includes('word')) return 'i-lucide:file-text'
    return 'i-lucide:file'
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
    return Math.round((bytes / (1024 * 1024)) * 10) / 10 + ' MB'
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
              ALLOWED_TAGS: [
                'p',
                'br',
                'div',
                'span',
                'a',
                'b',
                'i',
                'em',
                'strong',
                'u',
                'ul',
                'ol',
                'li',
                'blockquote',
                'h1',
                'h2',
                'h3',
                'h4',
                'h5',
                'h6',
                'img',
                'table',
                'tr',
                'td',
                'th',
                'thead',
                'tbody',
                'pre',
                'code',
              ],
              ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'style', 'target'],
            }),
          }}
        />
      )
    }

    return (
      <pre className="whitespace-pre-wrap font-sans text-[var(--text-primary)]">
        {bodyValue.value}
      </pre>
    )
  }

  // Use thread emails if available, otherwise just the current email
  // Sort emails by receivedAt (newest first)
  const displayEmails = (threadEmails || [email]).sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
  )

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
                className="p-2 hover:bg-white/10 rounded-lg"
                title="Back"
              >
                <div className="i-lucide:arrow-left" />
              </button>

              <h2 className="text-lg font-medium text-[var(--text-primary)] ml-2">
                {email.subject || '(no subject)'}
              </h2>

              {displayEmails.length > 1 && (
                <span className="text-sm text-[var(--text-tertiary)] ml-2">
                  ({displayEmails.length} messages)
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => handleReply('reply')}
                className="p-2 hover:bg-white/10 rounded-lg"
                title="Reply"
              >
                <div className="i-lucide:reply" />
              </button>
              <button
                onClick={() => handleReply('replyAll')}
                className="p-2 hover:bg-white/10 rounded-lg"
                title="Reply All"
              >
                <div className="i-lucide:reply-all" />
              </button>
              <button
                onClick={() => handleReply('forward')}
                className="p-2 hover:bg-white/10 rounded-lg"
                title="Forward"
              >
                <div className="i-lucide:forward" />
              </button>
              <div className="w-px h-6 bg-[var(--border-color)] mx-1" />
              <button
                onClick={handleFlag}
                className="p-2 hover:bg-white/10 rounded-lg"
                title={email.keywords.$flagged ? 'Unflag' : 'Flag'}
              >
                <div
                  className={`${email.keywords.$flagged ? 'i-lucide:star-fill text-[var(--accent-pink)]' : 'i-lucide:star'}`}
                />
              </button>
              <button
                onClick={handleDelete}
                className="p-2 hover:bg-white/10 rounded-lg"
                title="Delete"
              >
                <div className="i-lucide:trash-2" />
              </button>
            </div>
          </div>

          {/* Email thread */}
          <div className="flex-1 overflow-y-auto timeline-scrollbar" ref={timelineRef}>
            <div className="email-timeline max-w-4xl mx-auto pt-4 pb-6 px-6">
              {displayEmails.map((threadEmail, index) => {
                const isExpanded = expandedEmails.has(threadEmail.id)
                const isCurrent = threadEmail.id === email.id
                const sender = threadEmail.from?.[0]
                const isLatest = index === displayEmails.length - 1

                return (
                  <div
                    key={threadEmail.id}
                    ref={(el) => el && emailRefs.current.set(threadEmail.id, el)}
                    className={`timeline-marker mb-6 ${isLatest ? 'slide-in' : ''}`}
                  >
                    {/* Email header */}
                    <div
                      onClick={() => toggleEmailExpansion(threadEmail.id)}
                      className={`
                        bg-[var(--bg-secondary)] rounded-lg p-4 cursor-pointer 
                        hover:bg-[var(--bg-tertiary)]
                        ${isCurrent ? 'ring-2 ring-[var(--primary-color)]' : ''}
                      `}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          <div
                            className={`
                            w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0
                            ${isCurrent ? 'bg-[var(--primary-color)]' : 'bg-[var(--accent-cyan)]'}
                          `}
                          >
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
                          <span>
                            {format(new Date(threadEmail.receivedAt), 'MMM d, yyyy at HH:mm')}
                          </span>
                          <div
                            className={`i-lucide:chevron-down ${isExpanded ? 'rotate-180' : ''}`}
                          />
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
                        {/* Recipients info */}
                        {(threadEmail.to || threadEmail.cc) && (
                          <div className="mb-4 text-sm text-[var(--text-tertiary)] space-y-1">
                            {threadEmail.to && threadEmail.to.length > 0 && (
                              <div>
                                <span className="font-medium">To:</span>{' '}
                                {threadEmail.to.map((r) => r.name || r.email).join(', ')}
                              </div>
                            )}
                            {threadEmail.cc && threadEmail.cc.length > 0 && (
                              <div>
                                <span className="font-medium">Cc:</span>{' '}
                                {threadEmail.cc.map((r) => r.name || r.email).join(', ')}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Email body */}
                        <div className="mb-6">{renderEmailContent(threadEmail)}</div>

                        {/* Attachments */}
                        {threadEmail.attachments && threadEmail.attachments.length > 0 && (
                          <div className="mt-6 pt-6 border-t border-[var(--border-color)]">
                            <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-3 flex items-center gap-2">
                              <div className="i-lucide:paperclip" />
                              Attachments ({threadEmail.attachments.length})
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {threadEmail.attachments.map((attachment: any) => (
                                <button
                                  key={attachment.partId}
                                  onClick={() => handleDownloadAttachment(attachment)}
                                  className="flex items-center gap-3 p-4 bg-[var(--bg-tertiary)] rounded-lg hover:bg-white/10 text-left group"
                                >
                                  <div
                                    className={`${getAttachmentIcon(attachment.type || '')} text-2xl text-[var(--text-secondary)] group-hover:text-[var(--primary-color)]`}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate text-[var(--text-primary)]">
                                      {attachment.name || 'Untitled'}
                                    </p>
                                    <p className="text-xs text-[var(--text-tertiary)]">
                                      {formatFileSize(attachment.size)}
                                    </p>
                                  </div>
                                  <div className="i-lucide:download text-[var(--text-tertiary)] group-hover:text-[var(--primary-color)]" />
                                </button>
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

        {/* Timeline navigation bar - only show for threads */}
        {displayEmails.length > 1 && (
          <div className="w-16 bg-[var(--bg-secondary)] border-l border-[var(--border-color)] p-2">
            <div className="text-xs text-[var(--text-tertiary)] text-center mb-2">Timeline</div>
            <div className="relative h-full">
              {/* Create chronological timeline (oldest to newest) for visual clarity */}
              {[...displayEmails]
                .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime())
                .map((threadEmail, index, chronologicalEmails) => {
                  const position = (index / (chronologicalEmails.length - 1)) * 100
                  const date = new Date(threadEmail.receivedAt)
                  const isCurrent = threadEmail.id === email.id

                  return (
                    <button
                      key={threadEmail.id}
                      onClick={() => scrollToEmail(threadEmail.id)}
                      className="absolute left-1/2 -translate-x-1/2 group"
                      style={{ top: `${position}%` }}
                      title={format(date, 'MMM d, HH:mm')}
                    >
                      <div
                        className={`
                      w-3 h-3 rounded-full group-hover:scale-110
                      ${isCurrent ? 'bg-[var(--primary-color)]' : 'bg-[var(--accent-cyan)]'}
                    `}
                      />
                      <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 whitespace-nowrap text-xs bg-black/80 px-2 py-1 rounded">
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
