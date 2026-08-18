// Helpers for JMAP Calendars (JSCalendar, RFC 8984). We treat the event's
// `start` as wall-clock (LocalDateTime, e.g. "2026-07-15T14:00:00") and display
// it as given — timezone-perfect conversion can come later. This avoids the
// classic Date() UTC-shift bugs for a read-only v1.

export interface CalEvent {
  id: string
  calendarId: string
  uid: string
  title: string
  description?: string
  date: string // "YYYY-MM-DD" (local wall-clock) — used for grid placement
  time: string // "HH:MM" or '' for all-day
  endTime: string // "HH:MM" or ''
  allDay: boolean
  durationMin: number
  startUtc?: number | null // epoch ms; null for all-day/floating
  timeZone?: string | null
  location?: string
  status?: string
  color?: string
}

// ISO-8601 duration → minutes. "PT1H30M" → 90, "P1D" → 1440.
export function parseDurationMinutes(d?: string | null): number {
  if (!d) return 0
  const m = d.match(/^-?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!m) return 0
  const n = (i: number) => (m[i] ? parseInt(m[i], 10) : 0)
  return n(1) * 10080 + n(2) * 1440 + n(3) * 60 + n(4) + Math.round(n(5) / 60)
}

// --- Timezone math (Intl-based, no dependency) ---

// Offset (minutes, east-positive) of `tz` at the given UTC instant.
export function tzOffsetMinutes(tz: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value
  const hour = p.hour === '24' ? 0 : Number(p.hour)
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second)
  return Math.round((asIfUtc - utcMs) / 60000)
}

// A wall-clock "YYYY-MM-DDTHH:MM:SS" interpreted in `tz` → UTC epoch ms.
export function wallClockToUtcMs(localISO: string, tz: string): number {
  const guess = new Date(`${localISO}Z`).getTime() // treat wall clock as if UTC
  const offset = tzOffsetMinutes(tz, guess)
  return guess - offset * 60000
}

// Format a UTC instant as wall-clock date/time in `tz`.
export function formatInZone(utcMs: number, tz: string): { date: string; time: string } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value
  const hour = p.hour === '24' ? '00' : p.hour
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` }
}

// Short label like "GMT+7" for a zone at an instant.
export function zoneShortLabel(tz: string, utcMs: number): string {
  const off = tzOffsetMinutes(tz, utcMs)
  const sign = off >= 0 ? '+' : '-'
  const h = Math.floor(Math.abs(off) / 60)
  const m = Math.abs(off) % 60
  return `GMT${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`
}

export function listTimeZones(): string[] {
  try {
    // @ts-expect-error supportedValuesOf is newer than our lib target
    const zs = Intl.supportedValuesOf?.('timeZone') as string[] | undefined
    if (zs && zs.length) return zs
  } catch {
    /* fall through */
  }
  return ['UTC', 'Europe/Helsinki', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Bangkok', 'Asia/Tokyo', 'Asia/Singapore']
}

// Map a raw JMAP CalendarEvent (JSCalendar) into our flat shape, with all timed
// events converted into `displayTz`. All-day events stay date-only (floating).
export function parseJSEvent(raw: any, displayTz: string): CalEvent {
  const allDay = raw.showWithoutTime === true
  const durationMin = parseDurationMinutes(raw.duration)
  let date = (raw.start || '').slice(0, 10)
  let time = ''
  let endTime = ''
  let startUtc: number | null = null

  if (!allDay && raw.start) {
    const evTz = raw.timeZone || displayTz // floating events adopt the display zone
    startUtc = wallClockToUtcMs(raw.start, evTz)
    const s = formatInZone(startUtc, displayTz)
    date = s.date
    time = s.time
    endTime = formatInZone(startUtc + durationMin * 60000, displayTz).time
  }

  // JSCalendar `locations` is a map id → { name, ... }; take the first name.
  let location: string | undefined
  if (raw.locations && typeof raw.locations === 'object') {
    const first = Object.values(raw.locations)[0] as any
    location = first?.name
  }

  return {
    id: raw.id,
    calendarId: raw.calendarId,
    uid: raw.uid,
    title: raw.title || '(no title)',
    description: raw.description,
    date,
    time,
    endTime,
    allDay,
    durationMin,
    startUtc,
    timeZone: raw.timeZone,
    location,
    status: raw.status,
  }
}

// Local "YYYY-MM-DD" key for a Date.
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

// 6×7 Monday-first grid of Dates covering the given month.
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const lead = (first.getDay() + 6) % 7 // Monday = 0
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - lead + i))
}

// Group events by their local date key.
export function groupByDate(events: CalEvent[]): Record<string, CalEvent[]> {
  const map: Record<string, CalEvent[]> = {}
  for (const e of events) {
    if (!e.date) continue
    ;(map[e.date] ||= []).push(e)
  }
  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => (a.allDay === b.allDay ? a.time.localeCompare(b.time) : a.allDay ? -1 : 1))
  }
  return map
}

// "YYYY-MM-DD" → local Date (midnight).
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map((x) => parseInt(x, 10))
  return new Date(y, m - 1, d)
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

// Monday-anchored start of the week containing `d`.
export function startOfWeekMonday(d: Date): Date {
  const lead = (d.getDay() + 6) % 7
  return addDays(d, -lead)
}

// The 7 Date objects (Mon…Sun) of the week containing `d`.
export function weekDays(d: Date): Date[] {
  const start = startOfWeekMonday(d)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

export const HOURS = Array.from({ length: 24 }, (_, i) => i)

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function hmToMinutes(hm: string): number {
  if (!hm) return 0
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10))
  return h * 60 + m
}

export function minutesToHM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// Minutes → ISO-8601 duration for JSCalendar (e.g. 90 → "PT1H30M").
export function minutesToDuration(min: number): string {
  const m = Math.max(0, Math.round(min))
  return `PT${Math.floor(m / 60)}H${m % 60}M`
}

export function buildStartLocal(dateK: string, hm: string): string {
  return `${dateK}T${hm}:00`
}

export interface PlacedEvent {
  event: CalEvent
  startMin: number
  endMin: number
  top: number
  height: number
  leftPct: number
  widthPct: number
}

// Google-style side-by-side layout for a single day's timed events: overlapping
// events split the column width; independent clusters each use the full width.
export function layoutDayEvents(events: CalEvent[], hourHeight: number): PlacedEvent[] {
  const timed = events
    .filter((e) => !e.allDay && e.time)
    .map((e) => {
      const startMin = hmToMinutes(e.time)
      const endMin = Math.max(startMin + 30, startMin + (e.durationMin || 60))
      return { event: e, startMin, endMin }
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  const out: PlacedEvent[] = []
  let cluster: typeof timed = []
  let clusterEnd = -1

  const flush = () => {
    // Assign lanes greedily within the cluster, then width = 1 / laneCount.
    const laneEnds: number[] = []
    const laneOf = new Map<(typeof cluster)[number], number>()
    for (const it of cluster) {
      let lane = laneEnds.findIndex((end) => end <= it.startMin)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(it.endMin)
      } else {
        laneEnds[lane] = it.endMin
      }
      laneOf.set(it, lane)
    }
    const lanes = Math.max(1, laneEnds.length)
    for (const it of cluster) {
      const lane = laneOf.get(it)!
      out.push({
        ...it,
        top: (it.startMin / 60) * hourHeight,
        height: ((it.endMin - it.startMin) / 60) * hourHeight,
        leftPct: (lane / lanes) * 100,
        widthPct: (1 / lanes) * 100,
      })
    }
    cluster = []
    clusterEnd = -1
  }

  for (const it of timed) {
    if (cluster.length && it.startMin >= clusterEnd) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.endMin)
  }
  if (cluster.length) flush()
  return out
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
