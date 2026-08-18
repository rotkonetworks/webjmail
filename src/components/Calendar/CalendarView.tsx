import { useEffect, useMemo, useState } from 'react'
import { useCalendarStore, type CalMode } from '../../stores/calendarStore'
import { useCalendars, useCalendarRange, useCalendarMutations } from '../../hooks/useCalendar'
import { TimeGridView } from './TimeGridView'
import { MonthView } from './MonthView'
import { EventComposer } from './EventComposer'
import {
  weekDays,
  monthGrid,
  parseDateKey,
  addDays,
  buildStartLocal,
  minutesToHM,
  minutesToDuration,
  listTimeZones,
  MONTH_NAMES,
  type CalEvent,
} from '../../lib/calendar'
import { toast } from '../../stores/toastStore'
import { cn } from '../../lib/cn'

const DEFAULT_COLOR = 'var(--accent-cyan)'

type Menu =
  | { x: number; y: number; event: CalEvent }
  | { x: number; y: number; slot: { date: string; time: string } }

export function CalendarView() {
  const {
    mode, cursor, setMode, prev, next, today, goToDay,
    displayTz, extraZones, setDisplayTz, addZone, removeZone,
    defaultDurationMin, setDefaultDuration,
  } = useCalendarStore()
  const { data: calendars } = useCalendars()
  const mut = useCalendarMutations()

  const ref = parseDateKey(cursor)
  const { days, after, before, title } = useMemo(() => {
    if (mode === 'day') {
      const d = ref
      return {
        days: [d],
        after: d.toISOString(),
        before: addDays(d, 1).toISOString(),
        title: d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      }
    }
    if (mode === 'week') {
      const wd = weekDays(ref)
      const fmt = (x: Date) => x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      return {
        days: wd,
        after: wd[0].toISOString(),
        before: addDays(wd[6], 1).toISOString(),
        title: `${fmt(wd[0])} – ${fmt(wd[6])}, ${wd[6].getFullYear()}`,
      }
    }
    const g = monthGrid(ref.getFullYear(), ref.getMonth())
    return {
      days: g,
      after: g[0].toISOString(),
      before: addDays(g[41], 1).toISOString(),
      title: `${MONTH_NAMES[ref.getMonth()]} ${ref.getFullYear()}`,
    }
  }, [mode, cursor])

  const { events, isFetching, error, refetch } = useCalendarRange(after, before, displayTz)

  const colorFor = useMemo(() => {
    const map: Record<string, string> = {}
    for (const c of calendars ?? []) if (c.color) map[c.id] = c.color
    return (e: CalEvent) => map[e.calendarId] || DEFAULT_COLOR
  }, [calendars])

  // Composer + context menu state.
  const [composer, setComposer] = useState<
    null | { event?: CalEvent; initial?: { date?: string; time?: string; endTime?: string } }
  >(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [tzOpen, setTzOpen] = useState(false)
  const zones = useMemo(() => listTimeZones(), [])

  const onDragCommit = (e: CalEvent, newDateK: string, newStartMin: number, newDurMin: number) => {
    const hm = minutesToHM(newStartMin)
    mut
      .update(
        e.id,
        {
          start: buildStartLocal(newDateK, hm),
          duration: minutesToDuration(newDurMin),
          timeZone: displayTz,
          showWithoutTime: false,
        },
        {
          date: newDateK,
          time: hm,
          durationMin: newDurMin,
          endTime: minutesToHM(newStartMin + newDurMin),
        }
      )
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not move event'))
  }

  const cals = calendars ?? []

  // Keyboard-first control (Linear-style). Single keys are ignored while typing
  // or when an overlay is open (Esc closes overlays).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (composer || menu || tzOpen) {
        if (e.key === 'Escape') {
          setComposer(null)
          setMenu(null)
          setTzOpen(false)
        }
        return
      }
      const el = e.target as HTMLElement
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case 'd': setMode('day'); break
        case 'w': setMode('week'); break
        case 'm': setMode('month'); break
        case 't': today(); break
        case 'ArrowLeft': prev(); break
        case 'ArrowRight': next(); break
        case 'n':
        case 'c':
          setComposer({ initial: { date: cursor, time: '09:00' } })
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [composer, menu, tzOpen, cursor, setMode, today, prev, next])

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)] view-fade">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-[var(--border-color)]">
        <button
          onClick={() => setComposer({ initial: { date: cursor, time: '09:00' } })}
          className="btn-primary px-3 py-1.5 text-xs rounded flex items-center gap-1.5"
        >
          <div className="i-lucide:plus" /> New
        </button>
        <button onClick={today} className="px-3 py-1.5 text-xs rounded border border-[var(--border-color)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
          Today
        </button>
        <button onClick={prev} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]" title="Previous">
          <div className="i-lucide:chevron-left" />
        </button>
        <button onClick={next} className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]" title="Next">
          <div className="i-lucide:chevron-right" />
        </button>
        <h2 className="text-base font-semibold text-[var(--text-primary)] ml-1 truncate">{title}</h2>
        {isFetching && <div className="i-eos-icons:loading animate-spin text-[var(--text-tertiary)]" />}
        <div className="flex-1" />

        {/* Timezone control */}
        <div className="relative">
          <button
            onClick={() => setTzOpen((v) => !v)}
            className={cn(
              'px-2.5 py-1.5 text-xs rounded border border-[var(--border-color)] flex items-center gap-1.5 hover:bg-[var(--bg-tertiary)]',
              tzOpen ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
            )}
            title="Timezones"
          >
            <div className="i-lucide:globe" />
            <span className="max-w-[120px] truncate">{displayTz}</span>
          </button>
          {tzOpen && (
            <>
              <div className="fixed inset-0 z-[150]" onClick={() => setTzOpen(false)} />
              <div className="absolute right-0 mt-1 z-[151] w-72 p-3 rounded-lg shadow-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-xs space-y-3">
                <div>
                  <div className="text-[var(--text-tertiary)] mb-1">Display timezone</div>
                  <select
                    value={displayTz}
                    onChange={(e) => setDisplayTz(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5"
                  >
                    {zones.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="text-[var(--text-tertiary)] mb-1">Secondary timezones (rails)</div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {extraZones.length === 0 ? (
                      <span className="text-[var(--text-tertiary)]">None</span>
                    ) : (
                      extraZones.map((z) => (
                        <span
                          key={z}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                        >
                          {z}
                          <button onClick={() => removeZone(z)} className="hover:text-red-400" title="Remove">
                            <div className="i-lucide:x text-[10px]" />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addZone(e.target.value)
                    }}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5"
                  >
                    <option value="">Add a timezone…</option>
                    {zones
                      .filter((z) => z !== displayTz && !extraZones.includes(z))
                      .map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <div className="text-[var(--text-tertiary)] mb-1">Default new-event length</div>
                  <select
                    value={defaultDurationMin}
                    onChange={(e) => setDefaultDuration(Number(e.target.value))}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5"
                  >
                    {[15, 30, 45, 60, 90, 120].map((m) => (
                      <option key={m} value={m}>
                        {m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ' 30 min' : ''}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex rounded-md border border-[var(--border-color)] overflow-hidden text-xs">
          {(['day', 'week', 'month'] as CalMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'px-3 py-1.5 capitalize',
                mode === m
                  ? 'bg-[var(--primary-color)] text-[var(--on-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0">
        {error ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-[var(--text-secondary)]">
            <div className="i-lucide:calendar-x text-2xl text-[var(--text-tertiary)]" />
            Couldn’t load calendar
            <button onClick={() => refetch()} className="btn-primary px-3 py-1.5 text-xs rounded">
              Retry
            </button>
          </div>
        ) : mode === 'month' ? (
          <MonthView
            cursor={cursor}
            events={events}
            colorFor={colorFor}
            onOpenEvent={(e) => setComposer({ event: e })}
            onEventContext={(e, x, y) => setMenu({ x, y, event: e })}
            onOpenDay={(key) => goToDay(key)}
            onDayContext={(key, x, y) => setMenu({ x, y, slot: { date: key, time: '09:00' } })}
          />
        ) : (
          <TimeGridView
            days={days}
            events={events}
            displayTz={displayTz}
            extraZones={extraZones}
            defaultDurationMin={defaultDurationMin}
            colorFor={colorFor}
            onCreateAt={(date, time, endTime) => setComposer({ initial: { date, time, endTime } })}
            onOpenEvent={(e) => setComposer({ event: e })}
            onEventContext={(e, x, y) => setMenu({ x, y, event: e })}
            onSlotContext={(date, time, x, y) => setMenu({ x, y, slot: { date, time } })}
            onDragCommit={onDragCommit}
          />
        )}
      </div>

      {/* Context menu */}
      {menu && (
        <>
          <div className="fixed inset-0 z-[150]" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div
            className="fixed z-[151] w-44 py-1 rounded-lg shadow-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-sm"
            style={{ top: Math.min(menu.y, window.innerHeight - 120), left: Math.min(menu.x, window.innerWidth - 184) }}
          >
            {'event' in menu ? (
              <>
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  onClick={() => { setComposer({ event: menu.event }); setMenu(null) }}
                >
                  <div className="i-lucide:pencil text-[var(--text-tertiary)]" /> Edit
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-tertiary)] !text-red-400"
                  onClick={() => {
                    const ev = menu.event
                    setMenu(null)
                    mut.remove(ev.id).catch((err) => toast.error(err instanceof Error ? err.message : 'Delete failed'))
                  }}
                >
                  <div className="i-lucide:trash-2" /> Delete
                </button>
              </>
            ) : (
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                onClick={() => { setComposer({ initial: menu.slot }); setMenu(null) }}
              >
                <div className="i-lucide:plus text-[var(--text-tertiary)]" /> New event here
              </button>
            )}
          </div>
        </>
      )}

      {/* Create / edit */}
      {composer && (
        <EventComposer
          calendars={cals}
          event={composer.event}
          initial={composer.initial}
          onClose={() => setComposer(null)}
          onSaved={() => setComposer(null)}
        />
      )}
    </div>
  )
}
