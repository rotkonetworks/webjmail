// Minimal iCalendar (RFC 5545) → JSCalendar (RFC 8984) converter for importing
// .ics/.ical files. Covers what real-world invites and exports use: VEVENTs
// with DTSTART/DTEND/DURATION (DATE, UTC, TZID or floating), SUMMARY,
// DESCRIPTION, LOCATION, UID, STATUS and a basic RRULE. Participants and
// alarms are ignored.

export interface ParsedIcsEvent {
  uid?: string
  title: string
  description?: string
  location?: string
  start: string // LocalDateTime "YYYY-MM-DDTHH:MM:SS"
  durationMin: number
  allDay: boolean
  timeZone: string | null // null = floating/all-day
  tzFallback?: string // original TZID we couldn't resolve
  status?: string
  recurrenceRule?: Record<string, any>
}

export interface ParsedIcs {
  method?: string
  events: ParsedIcsEvent[]
}

interface Prop {
  name: string
  params: Record<string, string>
  value: string
}

// Unfold continuation lines (CRLF followed by space/tab) and split.
function unfold(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((l) => l.length > 0)
}

function parseLine(line: string): Prop | null {
  // Name and params end at the first ':' outside a quoted param value.
  let inQuote = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuote = !inQuote
    else if (c === ':' && !inQuote) {
      colon = i
      break
    }
  }
  if (colon < 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const parts = head.match(/(?:[^;"]|"[^"]*")+/g) || []
  const name = (parts.shift() || '').toUpperCase()
  const params: Record<string, string> = {}
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq < 0) continue
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name, params, value }
}

function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c))
}

// Windows zone names Outlook/Exchange put in TZID, mapped to IANA.
const WINDOWS_ZONES: Record<string, string> = {
  'FLE Standard Time': 'Europe/Helsinki',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Singapore Standard Time': 'Asia/Singapore',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'India Standard Time': 'Asia/Kolkata',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  UTC: 'Etc/UTC',
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// Resolve a TZID to an IANA zone, or null when we can't.
function resolveTzid(tzid: string): string | null {
  const clean = tzid.replace(/^\/+/, '').trim()
  if (validZone(clean)) return clean
  if (WINDOWS_ZONES[clean]) return WINDOWS_ZONES[clean]
  // Some generators prefix IANA names ("/mozilla.org/.../Europe/Helsinki").
  const m = clean.match(/([A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)$/)
  if (m && validZone(m[1])) return m[1]
  return null
}

interface DateVal {
  local: string // "YYYY-MM-DDTHH:MM:SS"
  dateOnly: boolean
  utc: boolean
  tzid?: string
}

function parseDateVal(p: Prop): DateVal | null {
  const v = p.value.trim()
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  const dateOnly = p.params.VALUE === 'DATE' || !m[4]
  const local = `${m[1]}-${m[2]}-${m[3]}T${dateOnly ? '00:00:00' : `${m[4]}:${m[5]}:${m[6] || '00'}`}`
  return { local, dateOnly, utc: !!m[7], tzid: p.params.TZID }
}

function toMs(d: DateVal): number {
  return new Date(`${d.local}Z`).getTime()
}

function parseDuration(v: string): number {
  const m = v
    .trim()
    .match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!m) return 0
  const n = (i: number) => (m[i] ? parseInt(m[i], 10) : 0)
  return n(2) * 10080 + n(3) * 1440 + n(4) * 60 + n(5) + Math.round(n(6) / 60)
}

const FREQ: Record<string, string> = {
  YEARLY: 'yearly',
  MONTHLY: 'monthly',
  WEEKLY: 'weekly',
  DAILY: 'daily',
  HOURLY: 'hourly',
  MINUTELY: 'minutely',
  SECONDLY: 'secondly',
}

function parseRrule(v: string): Record<string, any> | undefined {
  const parts: Record<string, string> = {}
  for (const kv of v.split(';')) {
    const [k, val] = kv.split('=')
    if (k && val) parts[k.toUpperCase()] = val
  }
  const frequency = FREQ[parts.FREQ?.toUpperCase()]
  if (!frequency) return undefined
  const rule: Record<string, any> = { '@type': 'RecurrenceRule', frequency }
  if (parts.INTERVAL) rule.interval = parseInt(parts.INTERVAL, 10)
  if (parts.COUNT) rule.count = parseInt(parts.COUNT, 10)
  if (parts.UNTIL) {
    const d = parseDateVal({ name: 'UNTIL', params: {}, value: parts.UNTIL })
    if (d) rule.until = d.local
  }
  if (parts.BYDAY) {
    rule.byDay = parts.BYDAY.split(',').map((d) => {
      const dm = d.match(/^([+-]?\d+)?([A-Z]{2})$/i)
      const nd: Record<string, any> = { '@type': 'NDay', day: (dm?.[2] || d).toLowerCase() }
      if (dm?.[1]) nd.nthOfPeriod = parseInt(dm[1], 10)
      return nd
    })
  }
  if (parts.BYMONTHDAY) rule.byMonthDay = parts.BYMONTHDAY.split(',').map(Number)
  if (parts.BYMONTH) rule.byMonth = parts.BYMONTH.split(',')
  if (parts.WKST) rule.firstDayOfWeek = parts.WKST.toLowerCase()
  return rule
}

function eventFromProps(props: Prop[], fallbackTz: string): ParsedIcsEvent | null {
  const get = (n: string) => props.find((p) => p.name === n)
  const dtstartP = get('DTSTART')
  if (!dtstartP) return null
  const start = parseDateVal(dtstartP)
  if (!start) return null

  const endP = get('DTEND')
  const end = endP ? parseDateVal(endP) : null
  const durP = get('DURATION')

  let durationMin: number
  if (end) durationMin = Math.round((toMs(end) - toMs(start)) / 60000)
  else if (durP) durationMin = parseDuration(durP.value)
  else durationMin = start.dateOnly ? 1440 : 0
  // DTEND in another zone than DTSTART is rare; the naive diff is close enough.
  if (durationMin < 0) durationMin = 0

  let timeZone: string | null = null
  let tzFallback: string | undefined
  if (!start.dateOnly) {
    if (start.utc) timeZone = 'Etc/UTC'
    else if (start.tzid) {
      timeZone = resolveTzid(start.tzid)
      if (!timeZone) {
        tzFallback = start.tzid
        timeZone = fallbackTz
      }
    } else timeZone = null // floating
  }

  const text = (n: string) => {
    const p = get(n)
    const v = p ? unescapeText(p.value).trim() : ''
    return v || undefined
  }
  const statusRaw = get('STATUS')?.value.toUpperCase()
  const status =
    statusRaw === 'CONFIRMED'
      ? 'confirmed'
      : statusRaw === 'TENTATIVE'
        ? 'tentative'
        : statusRaw === 'CANCELLED'
          ? 'cancelled'
          : undefined
  const rrule = get('RRULE')

  return {
    uid: get('UID')?.value.trim() || undefined,
    title: text('SUMMARY') || '(no title)',
    description: text('DESCRIPTION'),
    location: text('LOCATION'),
    start: start.local,
    durationMin,
    allDay: start.dateOnly,
    timeZone,
    tzFallback,
    status,
    recurrenceRule: rrule ? parseRrule(rrule.value) : undefined,
  }
}

export function parseIcs(text: string, fallbackTz: string): ParsedIcs {
  const lines = unfold(text)
  const out: ParsedIcs = { events: [] }
  const stack: string[] = []
  let current: Prop[] | null = null
  for (const line of lines) {
    const p = parseLine(line)
    if (!p) continue
    if (p.name === 'BEGIN') {
      const comp = p.value.trim().toUpperCase()
      stack.push(comp)
      if (comp === 'VEVENT' && stack.length === 2) current = []
      continue
    }
    if (p.name === 'END') {
      const comp = stack.pop()
      if (comp === 'VEVENT' && current) {
        const ev = eventFromProps(current, fallbackTz)
        if (ev) out.events.push(ev)
        current = null
      }
      continue
    }
    if (current && stack[stack.length - 1] === 'VEVENT') current.push(p)
    else if (stack.length === 1 && p.name === 'METHOD') out.method = p.value.trim().toUpperCase()
  }
  return out
}

// Same shape EventComposer builds, ready for CalendarEvent/set create.
export function toJSCalendar(ev: ParsedIcsEvent, calendarId: string): Record<string, any> {
  const m = Math.max(0, Math.round(ev.durationMin))
  const obj: Record<string, any> = {
    '@type': 'Event',
    calendarIds: { [calendarId]: true },
    title: ev.title,
    start: ev.start,
    duration: `PT${Math.floor(m / 60)}H${m % 60}M`,
    timeZone: ev.allDay ? null : ev.timeZone,
    showWithoutTime: ev.allDay,
    locations: ev.location ? { '1': { '@type': 'Location', name: ev.location } } : null,
    description: ev.description || null,
  }
  if (ev.uid) obj.uid = ev.uid
  if (ev.status) obj.status = ev.status
  if (ev.recurrenceRule) obj.recurrenceRules = [ev.recurrenceRule]
  return obj
}
