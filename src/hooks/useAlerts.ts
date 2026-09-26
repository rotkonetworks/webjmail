import { useEffect } from 'react'
import { jmapClient } from '../api/jmap'
import { isTauri } from '../lib/tauri'
import { raiseAlert, onAlertClick } from '../lib/alerts'
import { parseJSEvent, localTimeZone } from '../lib/calendar'
import { useAlertStore } from '../stores/alertStore'
import { useAuthStore } from '../stores/authStore'
import { useMailStore } from '../stores/mailStore'
import { useCalendarStore } from '../stores/calendarStore'
import type { Email } from '../api/types'

const POLL_MS = 60 * 1000
// Consecutive failed polls before we call an account unreachable (~3 min).
const FAILURES_BEFORE_ALERT = 3
// Beyond this many new messages in one poll, send one summary instead.
const MAX_INDIVIDUAL = 3
const FIRED_KEY = 'webjmail:alerts:fired-reminders'

// Per-account watcher state. `seen` is null until the first successful poll,
// which only seeds it: we alert on mail that arrives while the app is running,
// not on whatever was already sitting in the inbox.
interface Watch {
  seen: Set<string> | null
  failures: number // consecutive failed polls
  lastError: string
}

function loadFired(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

function saveFired(f: Record<string, number>) {
  const cutoff = Date.now() - 2 * 86400000
  for (const k of Object.keys(f)) if (f[k] < cutoff) delete f[k]
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(f))
  } catch {
    /* ignore */
  }
}

const sender = (e: Email) => {
  const f = e.from?.[0]
  return f?.name || f?.email || 'Unknown sender'
}

// Messages that look like an auth problem rather than a flaky network.
const isAuthError = (msg: string) => /401|403|unauthori[sz]ed|forbidden|not authenticated|expired|credential/i.test(msg)

// Watches every account's inbox, upcoming calendar events and connectivity,
// and raises alerts through lib/alerts. Mounted once, inside the logged-in
// layout.
export function useAlerts() {
  useEffect(() => {
    const watches = new Map<string, Watch>()
    // Outages we've alerted on and not yet seen recover. Network trouble is
    // keyed by server (all mailboxes on one host fail together, so that's one
    // alert, not four); login trouble by account.
    const down = new Set<string>()
    let stopped = false

    const accountNames = async (): Promise<Array<string | null>> => {
      // Desktop polls every configured account; the web build only has the
      // active session (null = "use the current session").
      if (!isTauri) return [null]
      const names = useAuthStore.getState().accounts.map((a) => a.name)
      return names.length ? names : [null]
    }

    const pollAccount = async (name: string | null) => {
      const key = name ?? '(current)'
      const w = watches.get(key) ?? { seen: null, failures: 0, lastError: '' }
      watches.set(key, w)
      try {
        const session = name === null ? jmapClient.getSession() : await jmapClient.getAccountSession(name)
        if (!session) throw new Error('Not authenticated')
        const { emails } = await jmapClient.getAccountInbox(session, name, 30)
        w.failures = 0
        w.lastError = ''

        const fresh = w.seen ? emails.filter((e) => !w.seen!.has(e.id) && !e.keywords?.$seen) : []
        w.seen = new Set(emails.map((e) => e.id))
        const { routes, mutedAccounts } = useAlertStore.getState()
        if (!fresh.length || !(routes.mail.desktop || routes.mail.ntfy)) return
        if (name && mutedAccounts.includes(name)) return

        const acct = name ? `${name}: ` : ''
        if (fresh.length > MAX_INDIVIDUAL) {
          void raiseAlert('mail', {
            title: `${acct}${fresh.length} new messages`,
            body: fresh.slice(0, 5).map((e) => `${sender(e)} — ${e.subject || '(no subject)'}`).join('\n'),
            category: 'email.arrived',
            clickId: `mail:${name ?? ''}:${fresh[0].id}`,
            tags: ['email'],
          })
          return
        }
        for (const e of fresh) {
          void raiseAlert('mail', {
            title: `${acct}${sender(e)}`,
            body: [e.subject || '(no subject)', e.preview?.slice(0, 140)].filter(Boolean).join('\n'),
            category: 'email.arrived',
            clickId: `mail:${name ?? ''}:${e.id}`,
            tags: ['email'],
          })
        }
      } catch (err) {
        w.failures++
        w.lastError = err instanceof Error ? err.message : String(err)
      }
    }

    // Turn this tick's per-account results into outage / recovery alerts.
    const checkHealth = (names: Array<string | null>) => {
      const auth = useAuthStore.getState()
      const serverOf = (n: string | null) =>
        (n && auth.accounts.find((a) => a.name === n)?.server) || auth.sessionInfo?.server || 'mail server'
      const labelOf = (n: string | null) => n ?? auth.sessionInfo?.username ?? 'your account'

      const netFailing = new Map<string, Array<string | null>>() // server → accounts due for an alert
      const netHealthy = new Map<string, boolean>() // server → every account on it succeeded
      for (const n of names) {
        const w = watches.get(n ?? '(current)')
        if (!w) continue
        const server = serverOf(n)
        const authKey = `auth:${labelOf(n)}`
        if (w.failures === 0) {
          netHealthy.set(server, netHealthy.get(server) ?? true)
          if (down.delete(authKey)) {
            void raiseAlert('failure', {
              title: `Signed in again: ${labelOf(n)}`,
              body: 'Mail is syncing again.',
              urgency: 'low',
              category: 'network.connected',
              priority: 2,
              tags: ['white_check_mark'],
            })
          }
          continue
        }
        netHealthy.set(server, false)
        if (isAuthError(w.lastError)) {
          // Login problems won't fix themselves — say so on the first failure.
          if (!down.has(authKey)) {
            down.add(authKey)
            void raiseAlert('failure', {
              title: `Login problem: ${labelOf(n)}`,
              body: w.lastError.slice(0, 300),
              urgency: 'critical',
              category: 'network.error',
              priority: 4,
              tags: ['warning'],
            })
          }
        } else if (w.failures >= FAILURES_BEFORE_ALERT) {
          netFailing.set(server, [...(netFailing.get(server) ?? []), n])
        }
      }

      for (const [server, failing] of netFailing) {
        const key = `net:${server}`
        if (down.has(key)) continue
        down.add(key)
        const w = watches.get(failing[0] ?? '(current)')!
        void raiseAlert('failure', {
          title: `Can't reach ${server}`,
          body: [failing.map(labelOf).join(', '), w.lastError.slice(0, 300)].join('\n'),
          urgency: 'critical',
          category: 'network.error',
          priority: 4,
          tags: ['warning'],
        })
      }
      for (const [server, healthy] of netHealthy) {
        if (healthy && down.delete(`net:${server}`)) {
          void raiseAlert('failure', {
            title: `Reconnected to ${server}`,
            body: 'Mail is syncing again.',
            urgency: 'low',
            category: 'network.connected',
            priority: 2,
            tags: ['white_check_mark'],
          })
        }
      }
    }

    const pollCalendar = async () => {
      if (!jmapClient.supportsCalendars()) return
      const lead = useAlertStore.getState().reminderMinutes * 60000
      const now = Date.now()
      // Pad the window a day each side: the server filters on event overlap,
      // and floating/zoned starts need converting before we can compare.
      const raw = await jmapClient.getCalendarEvents(
        new Date(now - 86400000).toISOString().slice(0, 19) + 'Z',
        new Date(now + lead + 86400000).toISOString().slice(0, 19) + 'Z'
      )
      const tz = localTimeZone()
      const fired = loadFired()
      let changed = false
      for (const r of raw) {
        const ev = parseJSEvent(r, tz)
        if (ev.allDay || !ev.startUtc || ev.status === 'cancelled') continue
        const k = `${ev.id}@${ev.startUtc}`
        if (fired[k]) continue
        // Fire from `lead` before the start until 5 min after it (covers a
        // laptop waking up just as the meeting begins).
        if (now < ev.startUtc - lead || now > ev.startUtc + 5 * 60000) continue
        fired[k] = now
        changed = true
        const mins = Math.round((ev.startUtc - now) / 60000)
        const when = mins > 0 ? `in ${mins} min` : mins === 0 ? 'now' : `started ${-mins} min ago`
        void raiseAlert('calendar', {
          title: `${ev.title} — ${when}`,
          body: [`${ev.time}–${ev.endTime}`, ev.location].filter(Boolean).join(' · '),
          urgency: 'critical',
          category: 'calendar.reminder',
          clickId: `cal:${ev.date}`,
          priority: 4,
          tags: ['calendar'],
        })
      }
      if (changed) saveFired(fired)
    }

    const tick = async () => {
      if (stopped) return
      const { routes } = useAlertStore.getState()
      const wantMail = routes.mail.desktop || routes.mail.ntfy
      const wantFail = routes.failure.desktop || routes.failure.ntfy
      const wantCal = routes.calendar.desktop || routes.calendar.ntfy
      if (wantMail || wantFail) {
        const names = await accountNames()
        await Promise.all(names.map(pollAccount))
        if (wantFail) checkHealth(names)
      }
      if (wantCal) await pollCalendar().catch((e) => console.error('[alerts] calendar poll failed:', e))
    }

    // Clicking a notification: open the message (switching account if
    // needed) or jump the calendar to the event's day.
    const openClick = async (clickId: string) => {
      if (clickId.startsWith('mail:')) {
        const [, account, emailId] = clickId.split(':')
        const auth = useAuthStore.getState()
        if (account && account !== auth.activeAccount) await auth.switchAccount(account, { quiet: true })
        useCalendarStore.getState().hide()
        useMailStore.getState().selectEmail(emailId)
      } else if (clickId.startsWith('cal:')) {
        const cal = useCalendarStore.getState()
        cal.setCursor(clickId.slice(4))
        cal.show()
      }
    }
    onAlertClick((id) => void openClick(id))

    let unlisten: (() => void) | undefined
    if (isTauri) {
      void import('@tauri-apps/api/event').then(({ listen }) =>
        listen<{ clickId: string }>('alert-click', (e) => {
          if (e.payload?.clickId) void openClick(e.payload.clickId)
        }).then((un) => {
          if (stopped) un()
          else unlisten = un
        })
      )
    }

    const first = window.setTimeout(tick, 5000)
    const id = window.setInterval(tick, POLL_MS)
    return () => {
      stopped = true
      window.clearTimeout(first)
      window.clearInterval(id)
      onAlertClick(null)
      unlisten?.()
    }
  }, [])
}
