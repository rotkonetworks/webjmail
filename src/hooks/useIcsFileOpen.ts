import { useEffect } from 'react'
import { isTauri, invoke } from '../lib/tauri'
import { useIcsImportStore } from '../stores/icsImportStore'

interface IcsFile {
  name: string
  text: string
}

// Desktop: pick up .ics/.ical files the OS opened with webjmail — both at
// launch (argv) and while running (forwarded by the single-instance plugin).
// Rust queues them until we drain, so a file opened before login waits here.
export function useIcsFileOpen() {
  useEffect(() => {
    if (!isTauri) return
    let unlisten: (() => void) | undefined
    let cancelled = false
    const drain = async () => {
      try {
        const files = await invoke<IcsFile[]>('take_pending_ics')
        for (const f of files) useIcsImportStore.getState().open({ text: f.text, source: f.name })
      } catch (err) {
        console.error('[ics] take_pending_ics failed:', err)
      }
    }
    ;(async () => {
      const { listen } = await import('@tauri-apps/api/event')
      // Listen before draining so a file arriving in between isn't missed.
      const un = await listen('ics-open', () => void drain())
      if (cancelled) un()
      else unlisten = un
      await drain()
    })()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
}
