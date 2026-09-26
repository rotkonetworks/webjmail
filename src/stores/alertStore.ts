import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// What to alert on, and where each kind of alert goes. Delivery lives in
// lib/alerts.ts; detection in hooks/useAlerts.ts.
export type AlertTrigger = 'mail' | 'calendar' | 'failure'

export interface AlertRoute {
  desktop: boolean
  ntfy: boolean
}

interface AlertState {
  routes: Record<AlertTrigger, AlertRoute>
  ntfyServer: string
  ntfyTopic: string
  ntfyAuth: string // access token (tk_…) or user:password; blank for open topics
  mutedAccounts: string[] // account names that never raise mail alerts
  reminderMinutes: number // calendar reminder lead time
  setRoute: (t: AlertTrigger, ch: keyof AlertRoute, on: boolean) => void
  setNtfy: (p: Partial<Pick<AlertState, 'ntfyServer' | 'ntfyTopic' | 'ntfyAuth'>>) => void
  toggleAccountMuted: (name: string) => void
  setReminderMinutes: (m: number) => void
}

export const useAlertStore = create<AlertState>()(
  persist(
    (set) => ({
      routes: {
        mail: { desktop: true, ntfy: false },
        calendar: { desktop: true, ntfy: false },
        failure: { desktop: true, ntfy: false },
      },
      ntfyServer: 'https://ntfy.sh',
      ntfyTopic: '',
      ntfyAuth: '',
      mutedAccounts: [],
      reminderMinutes: 10,
      setRoute: (t, ch, on) => set((s) => ({ routes: { ...s.routes, [t]: { ...s.routes[t], [ch]: on } } })),
      setNtfy: (p) => set(p),
      toggleAccountMuted: (name) =>
        set((s) => ({
          mutedAccounts: s.mutedAccounts.includes(name)
            ? s.mutedAccounts.filter((n) => n !== name)
            : [...s.mutedAccounts, name],
        })),
      setReminderMinutes: (reminderMinutes) => set({ reminderMinutes }),
    }),
    { name: 'webjmail:alerts', version: 1 }
  )
)
