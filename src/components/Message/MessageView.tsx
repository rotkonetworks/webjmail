// src/components/Message/MessageView.tsx
import { useState, useRef, useEffect } from 'react'
import { useMailStore } from '../../stores/mailStore'
import { useUIStore } from '../../stores/uiStore'
import {
  useMarkAsRead,
  useFlagEmail,
  useDeleteEmail,
  usePrimaryAccountId,
  useEmailThread,
} from '../../hooks'
import DOMPurify from 'dompurify'
import { format } from 'date-fns'
import { jmapClient } from '../../api/jmap'

interface MessageViewProps {
  onClose?: () => void
  onReply?: (mode: 'reply' | 'replyAll' | 'forward', replyTo: any) => void
}

export function MessageView({ onClose, onReply }: MessageViewProps = {}) {
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const emails = useMailStore((state) => state.emails)
  const email = selectedEmailId ? emails[selectedEmailId] : null
  const accountId = usePrimaryAccountId()
  const selectEmail = useMailStore((state) => state.selectEmail)
  const imageLoadingMode = useUIStore((state) => state.imageLoadingMode)
  const htmlRichness = useUIStore((state) => state.htmlRichness)
  const markAsRead = useMarkAsRead()
  const flagEmail = useFlagEmail()
  const deleteEmail = useDeleteEmail()

  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set())
  const [allowedImageEmails, setAllowedImageEmails] = useState<Set<string>>(new Set())
  const timelineRef = useRef<HTMLDivElement>(null)
  const emailRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Fetch thread emails
  const { data: threadEmails, isLoading: isLoadingThread } = useEmailThread(email?.threadId || null)

  // Mark as read
  useEffect(() => {
    if (email && !email.keywords.$seen && accountId) {
      // Add a small delay to prevent multiple rapid calls
      const timeoutId = setTimeout(() => {
        markAsRead.mutate({ emailId: email.id, isRead: true })
      }, 500)
      
      return () => clearTimeout(timeoutId)
    }
  }, [email?.id, email?.keywords.$seen, accountId])

  // Expand current email by default (or latest if in thread view)
  useEffect(() => {
    if (email) {
      if (threadEmails && threadEmails.length > 1) {
        // In thread view, expand the current selected email
        setExpandedEmails(new Set([email.id]))
        
        // Scroll to current email after render
        setTimeout(() => {
          const element = emailRefs.current.get(email.id)
          element?.scrollIntoView({ behavior: 'auto', block: 'start' })
        }, 50)
      } else {
        // Single email view - just expand it
        setExpandedEmails(new Set([email.id]))
      }
    }
  }, [email?.id, threadEmails])

  // Handle single image loading clicks
  useEffect(() => {
    const handleLoadImage = (e: MouseEvent) => {
      const button = e.target as HTMLElement
      if (button.classList.contains('load-single-image')) {
        const wrapper = button.closest('.blocked-image-wrapper') as HTMLElement
        if (wrapper) {
          const src = wrapper.getAttribute('data-original-src')
          const width = wrapper.getAttribute('data-original-width')
          const height = wrapper.getAttribute('data-original-height')
          
          if (src) {
            const img = document.createElement('img')
            img.src = src
            img.style.maxWidth = '100%'
            img.style.height = 'auto'
            if (width !== 'auto') img.setAttribute('width', width)
            if (height !== 'auto') img.setAttribute('height', height)
            
            wrapper.replaceWith(img)
          }
        }
      }
    }
    
    document.addEventListener('click', handleLoadImage)
    return () => document.removeEventListener('click', handleLoadImage)
  }, [])

  if (!email || !accountId) return null

  const handleReply = (mode: 'reply' | 'replyAll' | 'forward') => {
    if (onReply) {
      // Always use inline composer
      onReply(mode, {
        emailId: email.id,
        subject: email.subject,
        from: email.from || [],
        to: email.to || [],
        cc: email.cc,
      })
    }
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

  const toggleImageLoading = (emailId: string) => {
    setAllowedImageEmails((prev) => {
      const next = new Set(prev)
      if (next.has(emailId)) {
        next.delete(emailId)
      } else {
        next.add(emailId)
      }
      return next
    })
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

    // Check if images should be loaded for this email
    const shouldLoadImages = imageLoadingMode === 'always' || 
                           (imageLoadingMode === 'ask' && allowedImageEmails.has(email.id))

    let hasBlockedImages = false

    if (htmlBody) {
      // Configure DOMPurify based on richness setting
      const purifyConfig = htmlRichness === 'minimal' ? {
        ALLOWED_TAGS: [
          'p', 'br', 'div', 'span', 'a', 'b', 'i', 'em', 'strong', 'u',
          'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'table', 'tr', 'td', 'th', 'thead', 'tbody',
          'pre', 'code', 'img',
        ],
        ALLOWED_ATTR: ['href', 'alt', 'src', 'width', 'height', 'data-original-src'],
        FORBID_TAGS: ['script', 'style', 'object', 'embed', 'iframe', 'form', 'input'],
        FORBID_ATTR: ['style', 'class', 'id', 'onclick', 'onload', 'onerror'],
      } : {
        ALLOWED_TAGS: [
          'p', 'br', 'div', 'span', 'a', 'b', 'i', 'em', 'strong', 'u',
          'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'table', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'caption', 'colgroup', 'col',
          'pre', 'code', 'hr', 'img', 'picture', 'source', 'figure', 'figcaption',
          'center', 'font', 'small', 'big', 'sup', 'sub', 'abbr', 'address',
          'article', 'aside', 'footer', 'header', 'main', 'nav', 'section',
          'style',
        ],
        ALLOWED_ATTR: [
          'href', 'alt', 'class', 'id', 'target', 'rel', 'title',
          'style',
          'width', 'height', 'align', 'valign', 'bgcolor', 'border', 'cellpadding', 'cellspacing',
          'color', 'size', 'face',
          'src', 'srcset', 'sizes', 'data-original-src',
          'type', 'media',
          'colspan', 'rowspan',
          'role', 'aria-label', 'aria-hidden',
        ],
        ALLOW_DATA_ATTR: true,
        FORBID_TAGS: ['script', 'object', 'embed', 'iframe', 'form', 'input', 'button', 'select', 'textarea'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
      }

      let sanitizedHtml = DOMPurify.sanitize(bodyValue.value, {
        ...purifyConfig,
        KEEP_CONTENT: true,
        ADD_ATTR: ['target'],
        ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data|file|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      })

      // Block external images if needed
      if (!shouldLoadImages) {
        const parser = new DOMParser()
        const doc = parser.parseFromString(sanitizedHtml, 'text/html')
        const images = doc.querySelectorAll('img')
        
        // Check if there are any external images to block
        const externalImages = Array.from(images).filter(img => {
          const src = img.getAttribute('src')
          return src && !src.startsWith('data:')
        })
        
        hasBlockedImages = externalImages.length > 0
        
        externalImages.forEach((img, index) => {
          const src = img.getAttribute('src')
          if (src && !src.startsWith('data:')) {
            // Preserve original dimensions
            const width = img.getAttribute('width') || 'auto'
            const height = img.getAttribute('height') || 'auto'
            const alt = img.getAttribute('alt') || 'Blocked image'
            
            // Create wrapper with original dimensions
            const wrapper = doc.createElement('div')
            wrapper.className = 'blocked-image-wrapper'
            wrapper.style.width = width === 'auto' ? '100%' : `${width}px`
            wrapper.style.height = height === 'auto' ? '200px' : `${height}px`
            wrapper.style.maxWidth = '100%'
            wrapper.style.position = 'relative'
            wrapper.style.background = 'var(--bg-tertiary)'
            wrapper.style.border = '1px solid var(--border-color)'
            wrapper.style.borderRadius = '4px'
            wrapper.style.display = 'flex'
            wrapper.style.alignItems = 'center'
            wrapper.style.justifyContent = 'center'
            wrapper.style.overflow = 'hidden'
            
            // Store original image data
            wrapper.setAttribute('data-original-src', src)
            wrapper.setAttribute('data-original-width', width.toString())
            wrapper.setAttribute('data-original-height', height.toString())
            wrapper.setAttribute('data-image-index', index.toString())
            
            // Create content
            wrapper.innerHTML = `
              <div style="text-align: center; padding: 1rem;">
                <div style="font-size: 2rem; opacity: 0.3; margin-bottom: 0.5rem;">🖼️</div>
                <div style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.5rem;">${alt}</div>
                <button 
                  class="load-single-image" 
                  data-index="${index}"
                  style="
                    padding: 0.25rem 0.75rem;
                    background: var(--primary-color);
                    color: white;
                    border: none;
                    border-radius: 4px;
                    font-size: 0.75rem;
                    cursor: pointer;
                  "
                >
                  Load image
                </button>
              </div>
            `
            
            // Replace image with wrapper
            img.parentNode?.replaceChild(wrapper, img)
          }
        })
        
        sanitizedHtml = doc.body.innerHTML
      }

      return (
        <>
          {imageLoadingMode === 'ask' && !shouldLoadImages && hasBlockedImages && (
            <div className="mb-4 p-3 bg-[var(--bg-tertiary)] rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <div className="i-lucide:shield text-[var(--accent-yellow)]" />
                <span>Images blocked for privacy</span>
              </div>
              <button
                onClick={() => toggleImageLoading(email.id)}
                className="text-sm px-3 py-1 bg-[var(--primary-color)] text-white rounded hover:bg-[var(--primary-hover)]"
              >
                Load all images
              </button>
            </div>
          )}
          <div
            className={`email-content ${htmlRichness === 'minimal' ? 'email-minimal' : ''}`}
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        </>
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
              title="Back (Escape)"
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
                  ref={(el) => { if (el) emailRefs.current.set(threadEmail.id, el) }}
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
  )
}
