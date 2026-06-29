// src/components/Message/InlineComposer.tsx
import { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useSendEmail, usePrimaryAccountId } from '../../hooks'
import { useDefaultIdentity } from '../../hooks/useIdentities'
import { jmapClient } from '../../api/jmap'
import { config } from '../../config'
import { toast } from '../../stores/toastStore'
import { useDraftStore } from '../../stores/draftStore'

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
    date?: string
    textBody?: string
    attachments?: Array<{ blobId: string; type: string; name: string; size: number }>
  }
  mode?: 'compose' | 'reply' | 'replyAll' | 'forward'
  isMobile?: boolean
  // Pre-fill for a fresh compose (used by the assistant's draft_email tool).
  initial?: { to?: string; cc?: string; subject?: string; body?: string }
  // When true, the to/cc/subject/body fields are bound to the shared draftStore
  // so the AI assistant can read and edit this draft live while the user types.
  bound?: boolean
  // Positioning overrides (the composer is fixed-position). rightPx applies on
  // desktop; bottomPx on both — used to keep the composer clear of the assistant
  // panel / its prompt input.
  rightPx?: number
  bottomPx?: number
  zIndex?: number
  // Embedded: fill the parent (no fixed positioning / card chrome). Used to host
  // the bound draft inside the assistant's Draft tab on narrow layouts.
  embedded?: boolean
}

export function InlineComposer({
  onClose,
  onMinimize,
  isMinimized = false,
  replyTo,
  mode = 'compose',
  isMobile = false,
  initial,
  bound = false,
  rightPx,
  bottomPx,
  zIndex,
  embedded = false,
}: InlineComposerProps) {
  // Fixed-position anchor. On mobile we pin to both edges (left/right); on
  // desktop we anchor from the right with a fixed width.
  const posStyle: React.CSSProperties = isMobile
    ? { bottom: bottomPx ?? 0, left: 8, right: 8, zIndex }
    : { bottom: bottomPx ?? 0, right: rightPx ?? 16, zIndex }
  const session = useAuthStore((state) => state.session)
  const accountId = usePrimaryAccountId()
  const sendEmail = useSendEmail()
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<
    Array<{ blobId: string; type: string; name: string; size: number }>
  >(() => (mode === 'forward' && replyTo?.attachments ? replyTo.attachments : []))
  const [uploading, setUploading] = useState(false)

  // From identity / alias selection (which address to send as).
  const { data: defaultIdentity, identities } = useDefaultIdentity()
  const [fromIdentityId, setFromIdentityId] = useState<string | null>(null)
  useEffect(() => {
    if (!fromIdentityId && defaultIdentity?.id) setFromIdentityId(defaultIdentity.id)
  }, [defaultIdentity, fromIdentityId])
  const selectedIdentity =
    identities?.find((i) => i.id === fromIdentityId) || defaultIdentity || null
  
  const [toLocal, setToLocal] = useState(
    mode === 'reply' && replyTo
      ? replyTo.from.map((a) => a.email).join(', ')
      : mode === 'replyAll' && replyTo
        ? [...replyTo.from, ...replyTo.to.filter((a) => a.email !== session?.username)]
            .map((a) => a.email)
            .join(', ')
        : (initial?.to ?? '')
  )

  const [ccLocal, setCcLocal] = useState(
    mode === 'replyAll' && replyTo?.cc ? replyTo.cc.map((a) => a.email).join(', ') : (initial?.cc ?? '')
  )

  const [subjectLocal, setSubjectLocal] = useState(
    replyTo
      ? mode === 'forward'
        ? `Fwd: ${replyTo.subject}`
        : replyTo.subject.startsWith('Re:')
          ? replyTo.subject
          : `Re: ${replyTo.subject}`
      : (initial?.subject ?? '')
  )

  // Pre-fill the body with a quoted original (reply/forward) or an assistant draft.
  const [bodyLocal, setBodyLocal] = useState(() => {
    if (!replyTo || mode === 'compose') return initial?.body ?? ''
    const fromStr =
      replyTo.from?.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ') || ''
    const dateStr = replyTo.date ? new Date(replyTo.date).toLocaleString() : ''
    const original = replyTo.textBody || ''
    if (mode === 'forward') {
      const toStr = replyTo.to?.map((a) => a.email).join(', ') || ''
      return `\n\n---------- Forwarded message ----------\nFrom: ${fromStr}\nDate: ${dateStr}\nSubject: ${replyTo.subject}\nTo: ${toStr}\n\n${original}\n`
    }
    const attribution = dateStr && fromStr ? `On ${dateStr}, ${fromStr} wrote:` : `${fromStr} wrote:`
    const quoted = original.split('\n').map((l) => `> ${l}`).join('\n')
    return `\n\n${attribution}\n${quoted}\n`
  })
  const [bccLocal, setBccLocal] = useState('')

  // When `bound`, fields live in the shared draftStore (so the assistant can
  // read/edit them live); otherwise they're local component state.
  const draft = useDraftStore()
  const setDraftField = useDraftStore((s) => s.setField)
  const to = bound ? draft.to : toLocal
  const cc = bound ? draft.cc : ccLocal
  const bcc = bound ? draft.bcc : bccLocal
  const subject = bound ? draft.subject : subjectLocal
  const body = bound ? draft.body : bodyLocal
  const setTo = bound ? (v: string) => setDraftField({ to: v }) : setToLocal
  const setCc = bound ? (v: string) => setDraftField({ cc: v }) : setCcLocal
  const setBcc = bound ? (v: string) => setDraftField({ bcc: v }) : setBccLocal
  const setSubject = bound ? (v: string) => setDraftField({ subject: v }) : setSubjectLocal
  const setBody = bound ? (v: string) => setDraftField({ body: v }) : setBodyLocal

  const [isSending, setIsSending] = useState(false)
  const [showCc, setShowCc] = useState(!!cc)
  const [showBcc, setShowBcc] = useState(false)

  // Auto-focus body on mount. For reply/forward the body is pre-filled with the
  // quoted original, so put the cursor at the top for the user to type above it.
  useEffect(() => {
    if (!isMinimized && bodyRef.current) {
      bodyRef.current.focus()
      if (body) bodyRef.current.setSelectionRange(0, 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMinimized])
  
  const isDirty = () =>
    [to, cc, bcc, subject, body].some((v) => v.trim().length > 0) || attachments.length > 0

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // allow re-selecting the same file later
    if (!files.length || !accountId) return
    setUploading(true)
    try {
      for (const file of files) {
        if (file.size > config.email.maxAttachmentSizeMB * 1024 * 1024) {
          toast.error(`${file.name} exceeds the ${config.email.maxAttachmentSizeMB}MB limit`)
          continue
        }
        const blob = await jmapClient.uploadBlob(accountId, file)
        setAttachments((prev) => [...prev, blob])
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Attachment upload failed')
    } finally {
      setUploading(false)
    }
  }

  const removeAttachment = (blobId: string) =>
    setAttachments((prev) => prev.filter((a) => a.blobId !== blobId))

  const formatSize = (bytes: number) =>
    bytes < 1024
      ? `${bytes} B`
      : bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(0)} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`

  // Guard against accidentally discarding a drafted message.
  const handleClose = () => {
    if (!isSending && isDirty() && !confirm('Discard this message?')) return
    onClose()
  }

  const handleSend = async () => {
    const validateEmail = (email: string): boolean => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return emailRegex.test(email) && email.length <= 254
    }

    const validateEmailList = (emailList: string): string[] => {
      const emails = emailList.split(',').map((e) => e.trim()).filter((e) => e.length > 0)
      const invalid = emails.filter((email) => !validateEmail(email))
      if (invalid.length > 0) {
        throw new Error(`Invalid email addresses: ${invalid.join(', ')}`)
      }
      return emails
    }

    if (!to.trim()) {
      toast.error('Please enter at least one recipient')
      return
    }

    let toEmails: string[], ccEmails: string[], bccEmails: string[]
    try {
      toEmails = validateEmailList(to)
      ccEmails = cc ? validateEmailList(cc) : []
      bccEmails = bcc ? validateEmailList(bcc) : []
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid email address')
      return
    }

    if (toEmails.length + ccEmails.length + bccEmails.length > 100) {
      toast.error('Too many recipients (limit: 100)')
      return
    }
    if (subject.length > config.security.maxSubjectLength) {
      toast.error(`Subject too long (limit: ${config.security.maxSubjectLength} characters)`)
      return
    }
    if (new Blob([body]).size > config.email.maxAttachmentSizeMB * 1024 * 1024) {
      toast.error(`Email body too large (limit: ${config.email.maxAttachmentSizeMB}MB)`)
      return
    }

    setIsSending(true)
    try {
      await sendEmail.mutateAsync({
        to: toEmails.map((email) => ({ email })),
        cc: ccEmails.length > 0 ? ccEmails.map((email) => ({ email })) : undefined,
        bcc: bccEmails.length > 0 ? bccEmails.map((email) => ({ email })) : undefined,
        subject: subject.trim(),
        textBody: body,
        inReplyTo: bound
          ? draft.replyToId
          : mode === 'reply' || mode === 'replyAll'
            ? replyTo?.emailId
            : undefined,
        fromIdentity: selectedIdentity
          ? { id: selectedIdentity.id, email: selectedIdentity.email, name: selectedIdentity.name }
          : undefined,
        attachments: attachments.length
          ? attachments.map((a) => ({ blobId: a.blobId, type: a.type, name: a.name }))
          : undefined,
      })
      onClose()
    } catch (error) {
      // useSendEmail.onError already surfaces a toast; just log here.
      if (import.meta.env.DEV) console.error('Failed to send email:', error)
    } finally {
      setIsSending(false)
    }
  }
  
  if (isMinimized) {
    return (
      <div style={posStyle} className={`fixed ${isMobile ? '' : 'w-80'} bg-[var(--bg-secondary)] rounded-t-lg shadow-lg border border-[var(--border-color)]`}>
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
                handleClose()
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
    <div
      style={embedded ? undefined : posStyle}
      className={
        embedded
          ? 'h-full w-full flex flex-col bg-[var(--bg-secondary)]'
          : `fixed ${isMobile ? '' : 'w-[500px]'} bg-[var(--bg-secondary)] rounded-t-lg shadow-2xl border border-[var(--border-color)] max-h-[80vh] flex flex-col`
      }
    >
      {/* Header — hidden when embedded (the Draft tab provides the title). */}
      {!embedded && (
      <div className="flex items-center justify-between p-3 border-b border-[var(--border-color)]">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
          {bound && <div className="i-lucide:sparkles text-[var(--primary-color)]" title="The assistant can edit this draft" />}
          {bound
            ? 'Draft'
            : mode === 'compose'
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
            onClick={handleClose}
            className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
            title="Close"
          >
            <div className="i-lucide:x text-sm" />
          </button>
        </div>
      </div>
      )}

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* From identity / alias */}
        {(identities?.length ?? 0) > 1 ? (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-[var(--text-secondary)] w-12">From:</label>
            <select
              value={fromIdentityId || ''}
              onChange={(e) => setFromIdentityId(e.target.value)}
              disabled={isSending}
              className="flex-1 text-sm bg-[var(--bg-secondary)] border-b border-[var(--border-color)] focus:border-[var(--primary-color)] outline-none py-1"
            >
              {identities!.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name ? `${i.name} <${i.email}>` : i.email}
                </option>
              ))}
            </select>
          </div>
        ) : selectedIdentity ? (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-[var(--text-secondary)] w-12">From:</label>
            <span className="flex-1 text-sm text-[var(--text-secondary)] py-1 truncate">
              {selectedIdentity.name
                ? `${selectedIdentity.name} <${selectedIdentity.email}>`
                : selectedIdentity.email}
            </span>
          </div>
        ) : null}

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
        
        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div
                key={a.blobId}
                className="flex items-center gap-2 max-w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-2 py-1 text-xs"
              >
                <div className="i-lucide:paperclip flex-shrink-0 text-[var(--text-tertiary)]" />
                <span className="truncate">{a.name}</span>
                <span className="text-[var(--text-tertiary)] flex-shrink-0">{formatSize(a.size)}</span>
                <button
                  onClick={() => removeAttachment(a.blobId)}
                  className="flex-shrink-0 text-[var(--text-tertiary)] hover:text-red-400"
                  title="Remove attachment"
                  disabled={isSending}
                >
                  <div className="i-lucide:x" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter sends, like most mail clients.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              handleSend()
            }
          }}
          className="w-full min-h-[200px] text-sm bg-transparent resize-none outline-none"
          placeholder="Type your message here… (⌘/Ctrl+Enter to send)"
          disabled={isSending}
        />
      </div>
      
      {/* Footer */}
      <div className="flex items-center justify-between p-3 border-t border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFiles}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded disabled:opacity-50"
            title="Attach file"
            disabled={isSending || uploading}
          >
            <div className={uploading ? 'i-eos-icons:loading animate-spin text-sm' : 'i-lucide:paperclip text-sm'} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            disabled={isSending}
          >
            Discard
          </button>
          <button
            onClick={handleSend}
            className="btn-primary px-4 py-1.5 text-xs rounded flex items-center"
            disabled={isSending || uploading || !to.trim()}
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
