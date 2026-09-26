import { useEffect, useMemo, useState } from 'react'
import { useCalendars, useCalendarMutations } from '../../hooks/useCalendar'
import { parseIcs, toJSCalendar } from '../../lib/ics'
import { formatInZone, wallClockToUtcMs, MONTH_NAMES } from '../../lib/calendar'
import { useCalendarStore } from '../../stores/calendarStore'
import { useIcsImportStore } from '../../stores/icsImportStore'
import { useAuthStore } from '../../stores/authStore'
import { jmapClient } from '../../api/jmap'
import { toast } from '../../stores/toastStore'

type RowState = { status: 'pending' | 'ok' | 'error'; message?: string }

// Previews the events of an .ics payload at the head of the import queue and
// adds the selected ones to a calendar.
export function IcsImportDialog() {
  const req = useIcsImportStore((s) => s.queue[0])
  const next = useIcsImportStore((s) => s.next)
  const session = useAuthStore((s) => s.session)
  const displayTz = useCalendarStore((s) => s.displayTz)
  const { data: calendars = [] } = useCalendars()
  const { create } = useCalendarMutations()

  const parsed = useMemo(() => (req ? parseIcs(req.text, displayTz) : null), [req, displayTz])
  const [calendarId, setCalendarId] = useState('')
  const [selected, setSelected] = useState<boolean[]>([])
  const [rows, setRows] = useState<RowState[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setSelected(parsed ? parsed.events.map((e) => e.status !== 'cancelled') : [])
    setRows([])
  }, [parsed])
  useEffect(() => {
    if (!calendarId && calendars[0]) setCalendarId(calendars[0].id)
  }, [calendars, calendarId])

  if (!req || !parsed || !session) return null

  const calendarsAvailable = jmapClient.supportsCalendars()
  const done = rows.length > 0 && !busy

  const whenLabel = (i: number) => {
    const ev = parsed.events[i]
    const [y, mo, d] = ev.start.slice(0, 10).split('-').map(Number)
    if (ev.allDay) {
      const days = Math.round(ev.durationMin / 1440)
      return `${d} ${MONTH_NAMES[mo - 1]} ${y}${days > 1 ? ` · ${days} days` : ''} · all day`
    }
    const utc = wallClockToUtcMs(ev.start, ev.timeZone || displayTz)
    const s = formatInZone(utc, displayTz)
    const e = formatInZone(utc + ev.durationMin * 60000, displayTz)
    const [sy, sm, sd] = s.date.split('-').map(Number)
    return `${sd} ${MONTH_NAMES[sm - 1]} ${sy} · ${s.time}–${e.time}`
  }

  const doImport = async () => {
    if (!calendarId) return
    setBusy(true)
    const results: RowState[] = parsed.events.map((_, i) =>
      selected[i] ? { status: 'pending' } : { status: 'error', message: 'Skipped' }
    )
    setRows([...results])
    let ok = 0
    for (let i = 0; i < parsed.events.length; i++) {
      if (!selected[i]) continue
      try {
        await create(toJSCalendar(parsed.events[i], calendarId))
        results[i] = { status: 'ok' }
        ok++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        results[i] = {
          status: 'error',
          message: /uid|exist|duplicate/i.test(msg) ? 'Already in your calendar' : msg,
        }
      }
      setRows([...results])
    }
    setBusy(false)
    if (ok > 0) {
      const first = parsed.events.find((_, i) => results[i].status === 'ok')!
      const cal = useCalendarStore.getState()
      cal.setCursor(first.start.slice(0, 10))
      cal.show()
      toast.success(`Added ${ok} event${ok === 1 ? '' : 's'} to your calendar`)
      if (results.every((r, i) => r.status === 'ok' || !selected[i])) next()
    }
  }

  const count = selected.filter(Boolean).length

  return (
    <div
      className="fixed inset-0 z-[130] bg-black/50 flex items-center justify-center p-4"
      onClick={() => !busy && next()}
    >
      <div
        className="w-full max-w-lg bg-[var(--bg-secondary)] rounded-lg shadow-2xl border border-[var(--border-color)] flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation()
            next()
          }
        }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Add to calendar</h3>
            <p className="text-xs text-[var(--text-tertiary)] truncate">{req.source}</p>
          </div>
          <button
            onClick={() => !busy && next()}
            className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
          >
            <div className="i-lucide:x text-sm" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {!calendarsAvailable ? (
            <p className="text-sm text-[var(--text-secondary)]">
              This account&apos;s server doesn&apos;t offer calendars.
            </p>
          ) : parsed.events.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">No events found in this file.</p>
          ) : (
            parsed.events.map((ev, i) => (
              <label
                key={i}
                className="flex items-start gap-3 p-3 rounded bg-[var(--bg-tertiary)] cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={!!selected[i]}
                  disabled={busy || done}
                  onChange={(e) =>
                    setSelected((s) => s.map((v, j) => (j === i ? e.target.checked : v)))
                  }
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {ev.title}
                    {ev.status === 'cancelled' && (
                      <span className="ml-2 text-xs text-red-400">cancelled</span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {whenLabel(i)}
                    {ev.recurrenceRule && ` · repeats ${ev.recurrenceRule.frequency}`}
                  </p>
                  {ev.location && (
                    <p className="text-xs text-[var(--text-tertiary)] truncate">{ev.location}</p>
                  )}
                  {ev.tzFallback && (
                    <p className="text-xs text-amber-500">
                      Unknown time zone &quot;{ev.tzFallback}&quot;, using {displayTz}
                    </p>
                  )}
                  {rows[i] && (
                    <p
                      className={
                        'text-xs mt-1 ' +
                        (rows[i].status === 'ok'
                          ? 'text-green-500'
                          : rows[i].status === 'pending'
                            ? 'text-[var(--text-tertiary)]'
                            : 'text-red-400')
                      }
                    >
                      {rows[i].status === 'ok'
                        ? 'Added'
                        : rows[i].status === 'pending'
                          ? 'Adding…'
                          : rows[i].message}
                    </p>
                  )}
                </div>
              </label>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-[var(--border-color)]">
          {calendarsAvailable && calendars.length > 1 ? (
            <select
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              disabled={busy || done}
              className="text-sm bg-transparent border-b border-[var(--border-color)] outline-none py-1.5 min-w-0"
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={next}
              disabled={busy}
              className="px-3 py-1.5 text-sm hover:bg-[var(--bg-tertiary)] rounded"
            >
              {done ? 'Close' : 'Cancel'}
            </button>
            {!done && calendarsAvailable && parsed.events.length > 0 && (
              <button
                onClick={doImport}
                disabled={busy || count === 0 || !calendarId}
                className="btn-primary px-4 py-1.5 text-sm rounded flex items-center gap-1.5"
              >
                {busy && <div className="i-eos-icons:loading animate-spin" />}
                Add {count > 1 ? `${count} events` : 'event'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
