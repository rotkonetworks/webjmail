import { useEffect, useMemo, useRef, useState } from 'react'
import { useMailboxes } from '../hooks'
import { useAuthStore } from '../stores/authStore'
import { useMailStore } from '../stores/mailStore'
import { useCalendarStore } from '../stores/calendarStore'
import { useUIStore } from '../stores/uiStore'
import { cn } from '../lib/cn'

interface Cmd {
  id: string
  label: string
  section: string
  icon: string
  hint?: string
  run: () => void
}

// Subsequence fuzzy match: "gtcal" matches "Go to Calendar".
function matches(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let i = 0
  for (const ch of t) {
    if (ch === q[i]) i++
    if (i === q.length) return true
  }
  return i === q.length
}

// Actions that live in the Layout (compose, settings, assistant) are triggered
// via a window event the Layout listens for.
const emit = (action: string) => window.dispatchEvent(new CustomEvent('webjmail:action', { detail: action }))

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: mailboxes } = useMailboxes()
  const accounts = useAuthStore((s) => s.accounts)
  const activeAccount = useAuthStore((s) => s.activeAccount)
  const switchAccount = useAuthStore((s) => s.switchAccount)
  const logout = useAuthStore((s) => s.logout)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const selectMailbox = useMailStore((s) => s.selectMailbox)
  const showUnified = useMailStore((s) => s.showUnifiedInbox)
  const showCalendar = useCalendarStore((s) => s.show)
  const hideCalendar = useCalendarStore((s) => s.hide)
  const setTheme = useUIStore((s) => s.setTheme)

  // Global ⌘K / Ctrl+K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const commands = useMemo<Cmd[]>(() => {
    if (!isAuthenticated) return []
    const go = (run: () => void) => () => {
      run()
      setOpen(false)
    }
    const list: Cmd[] = []
    list.push({ id: 'calendar', section: 'Go to', label: 'Calendar', icon: 'i-lucide:calendar-days', run: go(() => showCalendar()) })
    if (accounts.length > 1) {
      list.push({ id: 'unified', section: 'Go to', label: 'All inboxes', icon: 'i-lucide:layers', run: go(() => { hideCalendar(); showUnified() }) })
    }
    for (const mb of mailboxes ?? []) {
      list.push({ id: 'mb-' + mb.id, section: 'Go to', label: mb.name, icon: 'i-lucide:folder', run: go(() => { hideCalendar(); selectMailbox(mb.id) }) })
    }
    for (const a of accounts) {
      if (a.name !== activeAccount) {
        list.push({ id: 'acct-' + a.name, section: 'Accounts', label: 'Switch to ' + a.name, icon: 'i-lucide:user', run: go(() => void switchAccount(a.name)) })
      }
    }
    list.push({ id: 'compose', section: 'Actions', label: 'New message', hint: 'c', icon: 'i-lucide:pen-line', run: go(() => emit('compose')) })
    list.push({ id: 'assistant', section: 'Actions', label: 'Assistant', icon: 'i-lucide:sparkles', run: go(() => emit('assistant')) })
    list.push({ id: 'settings', section: 'Actions', label: 'Settings', icon: 'i-lucide:settings', run: go(() => emit('settings')) })
    list.push({ id: 'signout', section: 'Actions', label: 'Sign out', icon: 'i-lucide:log-out', run: go(() => logout()) })
    list.push({ id: 'theme-dark', section: 'Theme', label: 'Dark theme', icon: 'i-lucide:moon', run: go(() => setTheme('dark')) })
    list.push({ id: 'theme-light', section: 'Theme', label: 'Light theme', icon: 'i-lucide:sun', run: go(() => setTheme('light')) })
    list.push({ id: 'theme-system', section: 'Theme', label: 'System theme', icon: 'i-lucide:monitor', run: go(() => setTheme('system')) })
    return list
  }, [isAuthenticated, mailboxes, accounts, activeAccount, switchAccount, logout, selectMailbox, showUnified, showCalendar, hideCalendar, setTheme])

  const filtered = useMemo(() => commands.filter((c) => matches(query, c.label + ' ' + c.section)), [commands, query])

  useEffect(() => {
    if (sel >= filtered.length) setSel(0)
  }, [filtered.length, sel])

  if (!open) return null

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[sel]?.run() }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  // Group filtered by section (preserving order).
  const sections: string[] = []
  for (const c of filtered) if (!sections.includes(c.section)) sections.push(c.section)
  let flatIndex = -1

  return (
    <div className="fixed inset-0 z-[400] flex items-start justify-center pt-[12vh] bg-black/40 cmdp-in" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg mx-4 rounded-xl shadow-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden cmdp-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b border-[var(--border-color)]">
          <div className="i-lucide:search text-[var(--text-tertiary)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSel(0) }}
            onKeyDown={onKey}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent outline-none py-3.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
          />
          <kbd className="text-[10px] text-[var(--text-tertiary)] border border-[var(--border-color)] rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <div className="max-h-[54vh] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--text-tertiary)]">No matches</div>
          ) : (
            sections.map((section) => (
              <div key={section}>
                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{section}</div>
                {filtered
                  .filter((c) => c.section === section)
                  .map((c) => {
                    flatIndex++
                    const active = flatIndex === sel
                    const idx = flatIndex
                    return (
                      <button
                        key={c.id}
                        onMouseEnter={() => setSel(idx)}
                        onClick={() => c.run()}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2 text-left text-sm',
                          active ? 'bg-[var(--primary-color)]/15 text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
                        )}
                      >
                        <div className={cn(c.icon, 'text-[var(--text-tertiary)] flex-shrink-0')} />
                        <span className="flex-1 truncate">{c.label}</span>
                        {c.hint && <kbd className="text-[10px] text-[var(--text-tertiary)] border border-[var(--border-color)] rounded px-1.5 py-0.5">{c.hint}</kbd>}
                      </button>
                    )
                  })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
