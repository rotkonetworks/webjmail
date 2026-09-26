// Alert delivery: desktop notifications (freedesktop via Rust on the desktop
// build, the Notification API in a browser) and ntfy pushes.
import { isTauri, invoke } from './tauri'
import { useAlertStore, type AlertTrigger } from '../stores/alertStore'

export interface Alert {
  title: string
  body: string
  urgency?: 'low' | 'normal' | 'critical'
  category?: string // freedesktop category hint, e.g. "email.arrived"
  clickId?: string // echoed back via onAlertClick when the notification is clicked
  priority?: number // ntfy 1–5
  tags?: string[] // ntfy tags / emoji shortcodes
}

type ClickHandler = (clickId: string) => void
let clickHandler: ClickHandler | null = null
export function onAlertClick(h: ClickHandler | null) {
  clickHandler = h
}

async function sendDesktop(a: Alert): Promise<void> {
  if (isTauri) {
    await invoke('notify_desktop', {
      alert: { title: a.title, body: a.body, urgency: a.urgency, clickId: a.clickId, category: a.category },
    })
    return
  }
  const N = window.Notification
  if (!N) throw new Error('Notifications are not supported here')
  // Browsers only grant permission from a user gesture, so the Settings
  // "Send test" button is what actually asks; polls just use the answer.
  if (N.permission === 'default') await N.requestPermission()
  if (N.permission !== 'granted') throw new Error('Notification permission denied')
  const n = new N(a.title, { body: a.body, tag: a.clickId })
  if (a.clickId) {
    const id = a.clickId
    n.onclick = () => {
      window.focus()
      clickHandler?.(id)
    }
  }
}

async function sendNtfy(a: Alert): Promise<void> {
  const { ntfyServer, ntfyTopic, ntfyAuth } = useAlertStore.getState()
  if (!ntfyTopic.trim()) throw new Error('No ntfy topic configured')
  const payload = {
    server: ntfyServer,
    topic: ntfyTopic,
    title: a.title,
    message: a.body || a.title,
    priority: a.priority,
    tags: a.tags,
    auth: ntfyAuth || undefined,
  }
  if (isTauri) {
    await invoke('ntfy_publish', { alert: payload })
    return
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (ntfyAuth) {
    headers.Authorization =
      ntfyAuth.includes(':') && !ntfyAuth.startsWith('tk_') ? `Basic ${btoa(ntfyAuth)}` : `Bearer ${ntfyAuth}`
  }
  const resp = await fetch(ntfyServer.replace(/\/+$/, ''), {
    method: 'POST',
    headers,
    body: JSON.stringify({ topic: ntfyTopic, title: a.title, message: payload.message, priority: a.priority, tags: a.tags }),
  })
  if (!resp.ok) throw new Error(`ntfy returned ${resp.status}`)
}

// Deliver an alert on the channels configured for `trigger`. Failures are
// logged, not thrown — an alert must never break the thing that raised it.
export async function raiseAlert(trigger: AlertTrigger, a: Alert): Promise<void> {
  const route = useAlertStore.getState().routes[trigger]
  const jobs: Promise<void>[] = []
  if (route.desktop) jobs.push(sendDesktop(a))
  if (route.ntfy) jobs.push(sendNtfy(a))
  const results = await Promise.allSettled(jobs)
  for (const r of results) if (r.status === 'rejected') console.error('[alerts]', trigger, r.reason)
}

// Settings "Send test" buttons: throw so the UI can show what went wrong.
export async function testChannel(channel: 'desktop' | 'ntfy'): Promise<void> {
  const a: Alert = {
    title: 'Webjmail test alert',
    body: 'If you can see this, alerts are working.',
    tags: ['white_check_mark'],
  }
  await (channel === 'desktop' ? sendDesktop(a) : sendNtfy(a))
}
