import { create } from 'zustand'

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  id: number
  ts: number
  level: LogLevel
  text: string
}

// Ring-buffer cap so a chatty session can't grow memory unbounded.
const MAX = 800
let counter = 0

interface LogState {
  entries: LogEntry[]
  visible: boolean
  // Count of errors logged since the console was last opened — drives the badge.
  unseenErrors: number
  add: (level: LogLevel, text: string) => void
  clear: () => void
  toggle: () => void
  setVisible: (v: boolean) => void
}

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  visible: false,
  unseenErrors: 0,
  add: (level, text) =>
    set((s) => {
      const trimmed = s.entries.length >= MAX ? s.entries.slice(s.entries.length - MAX + 1) : s.entries
      return {
        entries: [...trimmed, { id: ++counter, ts: Date.now(), level, text }],
        unseenErrors:
          level === 'error' && !s.visible ? s.unseenErrors + 1 : s.unseenErrors,
      }
    }),
  clear: () => set({ entries: [], unseenErrors: 0 }),
  toggle: () => set((s) => ({ visible: !s.visible, unseenErrors: s.visible ? s.unseenErrors : 0 })),
  setVisible: (v) => set((s) => ({ visible: v, unseenErrors: v ? 0 : s.unseenErrors })),
}))
