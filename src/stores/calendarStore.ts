import { create } from 'zustand'
import { addDays, parseDateKey, dateKey, localTimeZone } from '../lib/calendar'

export type CalMode = 'day' | 'week' | 'month'

const SETTINGS_KEY = 'webjmail:calendar-settings'

interface CalSettings {
  displayTz: string
  extraZones: string[]
  defaultDurationMin: number
}

function loadSettings(): CalSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null')
    if (s && typeof s.displayTz === 'string') {
      return {
        displayTz: s.displayTz,
        extraZones: Array.isArray(s.extraZones) ? s.extraZones : [],
        defaultDurationMin: typeof s.defaultDurationMin === 'number' ? s.defaultDurationMin : 30,
      }
    }
  } catch {
    /* ignore */
  }
  return { displayTz: localTimeZone(), extraZones: [], defaultDurationMin: 30 }
}

function saveSettings(s: CalSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

interface CalendarState extends CalSettings {
  visible: boolean
  mode: CalMode
  cursor: string // "YYYY-MM-DD" reference date
  show: () => void
  hide: () => void
  setMode: (m: CalMode) => void
  prev: () => void
  next: () => void
  today: () => void
  goToDay: (key: string) => void
  setCursor: (key: string) => void
  setDisplayTz: (tz: string) => void
  addZone: (tz: string) => void
  removeZone: (tz: string) => void
  setDefaultDuration: (min: number) => void
}

const todayKey = () => dateKey(new Date())

function shift(cursor: string, mode: CalMode, dir: number): Date {
  const d = parseDateKey(cursor)
  if (mode === 'day') return addDays(d, dir)
  if (mode === 'week') return addDays(d, dir * 7)
  return new Date(d.getFullYear(), d.getMonth() + dir, 1)
}

const init = loadSettings()

export const useCalendarStore = create<CalendarState>((set) => ({
  visible: false,
  mode: 'week',
  cursor: todayKey(),
  displayTz: init.displayTz,
  extraZones: init.extraZones,
  defaultDurationMin: init.defaultDurationMin,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
  setMode: (mode) => set({ mode }),
  prev: () => set((s) => ({ cursor: dateKey(shift(s.cursor, s.mode, -1)) })),
  next: () => set((s) => ({ cursor: dateKey(shift(s.cursor, s.mode, 1)) })),
  today: () => set({ cursor: todayKey() }),
  goToDay: (key) => set({ mode: 'day', cursor: key }),
  setCursor: (key) => set({ cursor: key }),
  setDisplayTz: (tz) =>
    set((s) => {
      const next = { displayTz: tz, extraZones: s.extraZones, defaultDurationMin: s.defaultDurationMin }
      saveSettings(next)
      return { displayTz: tz }
    }),
  addZone: (tz) =>
    set((s) => {
      if (!tz || tz === s.displayTz || s.extraZones.includes(tz)) return s
      const extraZones = [...s.extraZones, tz]
      saveSettings({ displayTz: s.displayTz, extraZones, defaultDurationMin: s.defaultDurationMin })
      return { extraZones }
    }),
  removeZone: (tz) =>
    set((s) => {
      const extraZones = s.extraZones.filter((z) => z !== tz)
      saveSettings({ displayTz: s.displayTz, extraZones, defaultDurationMin: s.defaultDurationMin })
      return { extraZones }
    }),
  setDefaultDuration: (min) =>
    set((s) => {
      saveSettings({ displayTz: s.displayTz, extraZones: s.extraZones, defaultDurationMin: min })
      return { defaultDurationMin: min }
    }),
}))
