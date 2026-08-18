import { useLogStore, type LogLevel } from '../stores/logStore'

// Render arbitrary console args to a single readable line.
function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`
      if (a === undefined) return 'undefined'
      if (a === null) return 'null'
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

let installed = false

/**
 * Mirror console output and uncaught errors into the in-app console (logStore).
 * In a packaged Tauri build there's no browser devtools, so this is the only way
 * to see logs and errors in the field. The original console methods still run,
 * so nothing is lost when devtools ARE available (web/dev).
 */
export function installDevConsole() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const record = (level: LogLevel, args: unknown[]) => {
    try {
      useLogStore.getState().add(level, format(args))
    } catch {
      /* never let logging throw */
    }
  }

  ;(['log', 'info', 'warn', 'error', 'debug'] as const).forEach((level) => {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      record(level, args)
    }
  })

  window.addEventListener('error', (e) => {
    const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : ''
    record('error', [`${e.message}${where}`, e.error?.stack ?? ''])
  })

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    record('error', ['Unhandled promise rejection:', r instanceof Error ? r.stack || r.message : String(r)])
  })
}
