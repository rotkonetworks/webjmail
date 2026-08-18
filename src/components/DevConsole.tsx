import { useEffect, useRef, useState } from 'react'
import { useLogStore, type LogLevel } from '../stores/logStore'

const levelColor: Record<LogLevel, string> = {
  log: 'text-[var(--text-secondary)]',
  info: 'text-[var(--accent-cyan)]',
  debug: 'text-[var(--text-tertiary)]',
  warn: 'text-[var(--accent-yellow)]',
  error: 'text-red-400',
}

const FILTERS: Array<LogLevel | 'all'> = ['all', 'error', 'warn', 'info', 'log', 'debug']

/**
 * In-app console. Toggle with F12 (or Ctrl/Cmd+`). Mounted always so the toggle
 * shortcut and the error badge work even while the panel is closed. Captures
 * come from installDevConsole() → logStore.
 */
export function DevConsole() {
  const entries = useLogStore((s) => s.entries)
  const visible = useLogStore((s) => s.visible)
  const unseenErrors = useLogStore((s) => s.unseenErrors)
  const toggle = useLogStore((s) => s.toggle)
  const setVisible = useLogStore((s) => s.setVisible)
  const clear = useLogStore((s) => s.clear)
  const [filter, setFilter] = useState<LogLevel | 'all'>('all')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (
        e.key === 'F12' ||
        (mod && e.key === '`') ||
        (mod && e.shiftKey && (e.key === 'I' || e.key === 'i'))
      ) {
        e.preventDefault()
        toggle()
      } else if (e.key === 'Escape' && useLogStore.getState().visible) {
        setVisible(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, setVisible])

  useEffect(() => {
    if (visible) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [entries, visible])

  // Closed: show a small launcher so the feature is discoverable (and flags errors).
  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        title="Open console (F12)"
        className="fixed bottom-3 left-3 z-[300] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs shadow-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] opacity-70 hover:opacity-100"
      >
        <div className="i-lucide:terminal text-sm" />
        {unseenErrors > 0 && (
          <span className="min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center">
            {unseenErrors}
          </span>
        )}
      </button>
    )
  }

  const shown = filter === 'all' ? entries : entries.filter((e) => e.level === filter)
  const errorCount = entries.reduce((n, e) => n + (e.level === 'error' ? 1 : 0), 0)

  const copyAll = () => {
    const text = shown
      .map((e) => `${new Date(e.ts).toISOString()} [${e.level}] ${e.text}`)
      .join('\n')
    navigator.clipboard?.writeText(text)
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[300] h-[42vh] flex flex-col bg-[var(--bg-secondary)] border-t-2 border-[var(--border-color)] shadow-2xl">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--border-color)] text-xs">
        <div className="i-lucide:terminal text-sm text-[var(--text-secondary)]" />
        <span className="font-semibold text-[var(--text-primary)]">Console</span>
        <span className="text-[var(--text-tertiary)]">
          {entries.length} logs{errorCount ? `, ${errorCount} errors` : ''}
        </span>
        <div className="flex-1" />
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-1.5 py-0.5 rounded ${
              filter === f
                ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {f}
          </button>
        ))}
        <button
          onClick={copyAll}
          className="px-1.5 py-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
        >
          Copy
        </button>
        <button
          onClick={clear}
          className="px-1.5 py-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
        >
          Clear
        </button>
        <button
          onClick={() => setVisible(false)}
          className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
          title="Close (Esc)"
        >
          <div className="i-lucide:x text-sm" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-xs p-2 space-y-0.5">
        {shown.length === 0 ? (
          <div className="text-[var(--text-tertiary)] p-2">No logs</div>
        ) : (
          shown.map((e) => (
            <div key={e.id} className="flex gap-2 whitespace-pre-wrap break-words">
              <span className="text-[var(--text-tertiary)] flex-shrink-0">
                {new Date(e.ts).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className={`${levelColor[e.level]} flex-shrink-0 uppercase w-9`}>{e.level}</span>
              <span className="text-[var(--text-primary)] min-w-0">{e.text}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
