import { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useUnreadStore } from '../../stores/unreadStore'
import { bestGuessServer, isLikelyEmail } from '../../lib/discovery'

// Header dropdown to switch / add / remove accounts (multi-account).
// `compact` hides the name label (avatar only) for the mobile header.
export function AccountSwitcher({ compact = false }: { compact?: boolean }) {
  const accounts = useAuthStore((s) => s.accounts)
  const activeAccount = useAuthStore((s) => s.activeAccount)
  const switchAccount = useAuthStore((s) => s.switchAccount)
  const removeAccount = useAuthStore((s) => s.removeAccount)
  const isLoading = useAuthStore((s) => s.isLoading)
  const session = useAuthStore((s) => s.session)
  const unreadByAccount = useUnreadStore((s) => s.byAccount)

  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const activeName = activeAccount || session?.username || 'User'
  const firstLetter = activeName.charAt(0).toUpperCase()

  return (
    <div className="relative ml-4" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isLoading}
        className="flex items-center gap-3 disabled:opacity-50"
        title="Accounts"
      >
        <div className="w-8 h-8 bg-[var(--primary-color)] text-[var(--on-primary)] rounded-full flex items-center justify-center text-sm font-medium">
          {firstLetter}
        </div>
        {!compact && (
          <span className="text-sm text-[var(--text-secondary)] max-w-[180px] truncate">{activeName}</span>
        )}
        {isLoading ? (
          <div className="i-eos-icons:loading animate-spin text-xs text-[var(--text-tertiary)]" />
        ) : (
          <div
            className={`i-lucide:chevron-down text-xs text-[var(--text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 z-50 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 max-h-[70vh] overflow-y-auto">
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] sticky top-0 bg-[var(--bg-secondary)]">
            Accounts
          </div>
          {accounts.map((a) => {
            const isActive = a.name === activeAccount
            return (
              <div
                key={a.name}
                className="group w-full px-3 py-2 flex items-center gap-3 hover:bg-white/10 transition-colors"
              >
                <button
                  onClick={() => {
                    if (!isActive) switchAccount(a.name)
                    setOpen(false)
                  }}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <div className="w-7 h-7 bg-[var(--bg-tertiary)] rounded-full flex items-center justify-center text-xs font-medium text-[var(--text-secondary)]">
                    {a.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-[var(--text-primary)] truncate">{a.name}</div>
                    {a.username !== a.name && (
                      <div className="text-xs text-[var(--text-tertiary)] truncate">{a.username}</div>
                    )}
                  </div>
                </button>
                {unreadByAccount[a.name] > 0 && (
                  <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-[var(--primary-color)] text-[var(--on-primary)] font-medium">
                    {unreadByAccount[a.name] > 999 ? '999+' : unreadByAccount[a.name]}
                  </span>
                )}
                {isActive && <div className="i-lucide:check text-[var(--primary-color)] flex-shrink-0" />}
                <button
                  onClick={() => {
                    if (confirm(`Remove account "${a.name}"?`)) removeAccount(a.name)
                  }}
                  title="Remove account"
                  className="i-lucide:x text-[var(--text-tertiary)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                />
              </div>
            )
          })}

          <div className="border-t border-[var(--border-color)] mt-1 pt-1">
            <button
              onClick={() => {
                setAdding(true)
                setOpen(false)
              }}
              className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-white/10 transition-colors text-sm text-[var(--text-primary)]"
            >
              <div className="w-7 h-7 rounded-full border border-dashed border-[var(--border-color)] flex items-center justify-center">
                <div className="i-lucide:plus text-[var(--text-secondary)]" />
              </div>
              Add another account
            </button>
          </div>
        </div>
      )}

      {adding && <AddAccountModal onClose={() => setAdding(false)} />}
    </div>
  )
}

function AddAccountModal({ onClose }: { onClose: () => void }) {
  const addAccountAuto = useAuthStore((s) => s.addAccountAuto)
  const addAccount = useAuthStore((s) => s.addAccount)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [server, setServer] = useState('')
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!isLikelyEmail(email)) return setError('Enter a valid email address')
    if (!password) return setError('Enter the password')
    setBusy(true)
    try {
      if (manual) {
        if (!server.trim()) {
          setError('Enter the server')
          return
        }
        await addAccount(server.trim(), email, password, email)
        onClose()
        return
      }
      const found = await addAccountAuto(email, password)
      if (found) {
        onClose()
      } else {
        // Couldn't detect — reveal a pre-filled server field.
        setServer((s) => s || bestGuessServer(email))
        setManual(true)
        setError("Couldn't detect the mail server. Confirm it below.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add account')
    } finally {
      setBusy(false)
    }
  }

  const input =
    'w-full text-sm bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-md px-3 py-2 outline-none focus:border-[var(--primary-color)]'

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-sm min-w-0 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-[var(--text-primary)]">Add account</h3>
          <button onClick={onClose} className="i-lucide:x text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" title="Close" />
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={input}
            autoFocus
          />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className={input}
          />
          {manual && (
            <input
              type="text"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="mail.example.com or full JMAP URL"
              className={input}
            />
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy || !email || !password}
            className="btn-primary w-full py-2 rounded-lg text-sm disabled:opacity-50 flex items-center justify-center"
          >
            {busy ? <div className="i-eos-icons:loading animate-spin mr-2" /> : null}
            {busy ? 'Connecting…' : 'Add account'}
          </button>
        </form>
      </div>
    </div>
  )
}
