import { useMemo, useRef, useState } from 'react'
import { rankContacts, type Contact } from '../../hooks/useContacts'

interface Props {
  value: string
  onChange: (v: string) => void
  contacts: Contact[]
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
}

// A recipient text input (comma-separated addresses) with typeahead suggestions
// drawn from people already in the mailbox. Matching is fuzzy on name + email.
// Selecting a suggestion replaces the token currently being typed with its
// plain email (the send path validates bare addresses), and appends ", ".
export function RecipientInput({
  value,
  onChange,
  contacts,
  placeholder,
  disabled,
  autoFocus,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // The fragment being typed = text after the last comma.
  const lastComma = value.lastIndexOf(',')
  const currentToken = value.slice(lastComma + 1).trim()

  const matches = useMemo(() => {
    if (currentToken.length < 1) return []
    // Don't suggest something already fully typed.
    const already = new Set(
      value
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    )
    return rankContacts(contacts, currentToken).filter((c) => !already.has(c.email.toLowerCase()))
  }, [contacts, currentToken, value])

  const showMenu = open && matches.length > 0

  const applyContact = (c: Contact) => {
    const head = value.slice(0, lastComma + 1)
    const prefix = head ? head.replace(/\s*$/, '') + (head.trim() ? ' ' : '') : ''
    onChange(prefix + c.email + ', ')
    setOpen(false)
    setActive(0)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!showMenu) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + matches.length) % matches.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      // Only hijack Enter/Tab when a suggestion is highlighted.
      e.preventDefault()
      applyContact(matches[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        // Delay so a mousedown on a suggestion registers before we close.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
      />
      {showMenu && (
        <div className="absolute left-0 right-0 top-full mt-1 z-[210] max-h-60 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl py-1">
          {matches.map((c, i) => (
            <button
              key={c.email}
              type="button"
              // mousedown (not click) so it fires before the input's blur.
              onMouseDown={(e) => {
                e.preventDefault()
                applyContact(c)
              }}
              onMouseEnter={() => setActive(i)}
              className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-sm ${
                i === active ? 'bg-white/10' : ''
              }`}
            >
              <div className="w-6 h-6 flex-shrink-0 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-xs text-[var(--text-secondary)]">
                {(c.name || c.email).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                {c.name && <div className="truncate text-[var(--text-primary)]">{c.name}</div>}
                <div className="truncate text-xs text-[var(--text-tertiary)]">{c.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
