import { useEffect, useMemo, useRef, useState } from 'react'
import {
  HOURS,
  WEEKDAYS,
  dateKey,
  groupByDate,
  hmToMinutes,
  layoutDayEvents,
  minutesToHM,
  tzOffsetMinutes,
  wallClockToUtcMs,
  zoneShortLabel,
  type CalEvent,
} from '../../lib/calendar'

const HOUR_H = 48 // px per hour
const SNAP = 15 // minutes
const RAIL_W = 44 // px per secondary-timezone rail
const GUT_W = 56 // px primary hour gutter

interface Props {
  days: Date[]
  events: CalEvent[]
  displayTz: string
  extraZones: string[]
  defaultDurationMin: number
  colorFor: (e: CalEvent) => string
  // endHm is set when the user drags out a range; omitted for a plain click.
  onCreateAt: (dateK: string, hm: string, endHm?: string) => void
  onOpenEvent: (e: CalEvent) => void
  onEventContext: (e: CalEvent, x: number, y: number) => void
  onSlotContext: (dateK: string, hm: string, x: number, y: number) => void
  // Persist a moved/resized event. startMin/durMin are minutes-from-midnight.
  onDragCommit: (e: CalEvent, newDateK: string, newStartMin: number, newDurMin: number) => void
}

interface DragState {
  event: CalEvent
  kind: 'move' | 'resize'
  origStartMin: number
  origDurMin: number
  startClientX: number
  startClientY: number
  curStartMin: number
  curDurMin: number
  curDateK: string
  moved: boolean
}

const snap = (min: number) => Math.round(min / SNAP) * SNAP
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function TimeGridView({
  days,
  events,
  displayTz,
  extraZones,
  defaultDurationMin,
  colorFor,
  onCreateAt,
  onOpenEvent,
  onEventContext,
  onSlotContext,
  onDragCommit,
}: Props) {
  const colsRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hover, setHover] = useState<{ dateK: string; startMin: number } | null>(null)
  // Drag out a range on empty grid to create an event of any length.
  const [creating, setCreating] = useState<{ dateK: string; startMin: number; curMin: number } | null>(null)
  const creatingRef = useRef(creating)
  creatingRef.current = creating
  const createBgRef = useRef<HTMLElement | null>(null)
  const minAtClientY = (clientY: number): number => {
    const el = createBgRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return clamp(snap(((clientY - rect.top) / HOUR_H) * 60), 0, 1440)
  }
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag

  const byDate = useMemo(() => groupByDate(events), [events])
  const dayKeys = days.map(dateKey)
  const todayK = dateKey(new Date())
  // Re-render each minute so the "now" line stays live.
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 60000)
    return () => clearInterval(id)
  }, [])
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()

  // Open scrolled near "now" rather than staring at midnight.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = Math.max(0, ((nowMin - 90) / 60) * HOUR_H)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Secondary-timezone rails: offset (minutes) of each extra zone vs. the
  // display zone, sampled at noon on the first visible day (avoids DST edges).
  const leftWidth = GUT_W + extraZones.length * RAIL_W
  const refUtc = wallClockToUtcMs(`${dateKey(days[0])}T12:00:00`, displayTz)
  const zoneOffsetMin = (tz: string) => tzOffsetMinutes(tz, refUtc) - tzOffsetMinutes(displayTz, refUtc)

  // Column under a clientX (for moving events across days in week view).
  const dateKeyAtX = (clientX: number): string => {
    const el = colsRef.current
    if (!el) return dragRef.current?.curDateK ?? dayKeys[0]
    const rect = el.getBoundingClientRect()
    const idx = clamp(Math.floor(((clientX - rect.left) / rect.width) * days.length), 0, days.length - 1)
    return dayKeys[idx]
  }

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const dyMin = snap(((e.clientY - d.startClientY) / HOUR_H) * 60)
      let curStartMin = d.origStartMin
      let curDurMin = d.origDurMin
      let curDateK = d.curDateK
      if (d.kind === 'move') {
        curStartMin = clamp(d.origStartMin + dyMin, 0, 1440 - d.origDurMin)
        curDateK = dateKeyAtX(e.clientX)
      } else {
        curDurMin = clamp(d.origDurMin + dyMin, SNAP, 1440 - d.origStartMin)
      }
      const moved = d.moved || dyMin !== 0 || curDateK !== d.curDateK
      setDrag({ ...d, curStartMin, curDurMin, curDateK, moved })
    }
    const onUp = () => {
      const d = dragRef.current
      setDrag(null)
      if (!d) return
      if (d.moved) {
        onDragCommit(d.event, d.curDateK, d.curStartMin, d.curDurMin)
      } else {
        onOpenEvent(d.event)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null])

  useEffect(() => {
    if (!creating) return
    const onMove = (e: PointerEvent) => {
      setCreating((c) => (c ? { ...c, curMin: minAtClientY(e.clientY) } : c))
    }
    const onUp = () => {
      const c = creatingRef.current
      setCreating(null)
      setHover(null)
      if (!c) return
      const a = Math.min(c.startMin, c.curMin)
      const b = Math.max(c.startMin, c.curMin)
      if (b - a >= SNAP) onCreateAt(c.dateK, minutesToHM(a), minutesToHM(b))
      else onCreateAt(c.dateK, minutesToHM(c.startMin)) // no drag → click → default length
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating !== null])

  const startDrag = (e: React.PointerEvent, ev: CalEvent, kind: 'move' | 'resize') => {
    e.preventDefault()
    e.stopPropagation()
    const startMin = hmToMinutes(ev.time)
    setDrag({
      event: ev,
      kind,
      origStartMin: startMin,
      origDurMin: Math.max(SNAP, ev.durationMin || 60),
      startClientX: e.clientX,
      startClientY: e.clientY,
      curStartMin: startMin,
      curDurMin: Math.max(SNAP, ev.durationMin || 60),
      curDateK: ev.date,
      moved: false,
    })
  }

  const slotTimeAt = (e: React.MouseEvent): string => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const min = clamp(snap(((e.clientY - rect.top) / HOUR_H) * 60), 0, 1440 - SNAP)
    return minutesToHM(min)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Day headers */}
      <div className="flex border-b border-[var(--border-color)]">
        <div className="flex-shrink-0 flex items-end" style={{ width: leftWidth }}>
          {extraZones.map((tz) => (
            <div
              key={tz}
              style={{ width: RAIL_W }}
              className="text-[9px] text-center text-[var(--text-tertiary)] truncate pb-1"
              title={tz}
            >
              {zoneShortLabel(tz, refUtc)}
            </div>
          ))}
          <div
            style={{ width: GUT_W }}
            className="text-[9px] text-center text-[var(--text-secondary)] truncate pb-1"
            title={displayTz}
          >
            {zoneShortLabel(displayTz, refUtc)}
          </div>
        </div>
        {days.map((d) => {
          const k = dateKey(d)
          const isToday = k === todayK
          return (
            <div key={k} className="flex-1 min-w-0 border-l border-[var(--border-color)] py-1.5 text-center">
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                {WEEKDAYS[(d.getDay() + 6) % 7]}
              </div>
              <div
                className={`text-sm inline-flex items-center justify-center w-7 h-7 rounded-full ${
                  isToday
                    ? 'bg-[var(--primary-color)] text-[var(--on-primary)] font-semibold'
                    : 'text-[var(--text-primary)]'
                }`}
              >
                {d.getDate()}
              </div>
            </div>
          )
        })}
      </div>

      {/* All-day row */}
      <div className="flex border-b border-[var(--border-color)]">
        <div
          className="flex-shrink-0 text-[10px] text-[var(--text-tertiary)] text-right pr-1 pt-1"
          style={{ width: leftWidth }}
        >
          all-day
        </div>
        {days.map((d) => {
          const key = dateKey(d)
          const allDay = (byDate[key] ?? []).filter((e) => e.allDay)
          return (
            <div key={key} className="flex-1 min-w-0 border-l border-[var(--border-color)] p-1 space-y-0.5">
              {allDay.map((e) => (
                <div
                  key={e.id}
                  onClick={() => onOpenEvent(e)}
                  onContextMenu={(ev) => {
                    ev.preventDefault()
                    onEventContext(e, ev.clientX, ev.clientY)
                  }}
                  className="text-[11px] truncate rounded px-1 py-0.5 cursor-pointer text-[var(--text-primary)] bg-[var(--bg-tertiary)]"
                  style={{ background: `color-mix(in srgb, ${colorFor(e)} 30%, transparent)` }}
                >
                  {e.title}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex relative" style={{ height: HOUR_H * 24 }}>
          {/* Hour gutter (+ secondary-timezone rails) */}
          <div className="flex-shrink-0 flex relative" style={{ width: leftWidth }}>
            {extraZones.map((tz) => {
              const off = zoneOffsetMin(tz)
              return (
                <div key={tz} style={{ width: RAIL_W }} className="relative border-r border-[var(--border-color)]/40">
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="absolute right-1 text-[10px] text-[var(--text-tertiary)] -translate-y-1/2"
                      style={{ top: h * HOUR_H }}
                    >
                      {h === 0 ? '' : minutesToHM((((h * 60 + off) % 1440) + 1440) % 1440)}
                    </div>
                  ))}
                </div>
              )
            })}
            <div style={{ width: GUT_W }} className="relative">
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute right-1 text-[10px] text-[var(--text-tertiary)] -translate-y-1/2"
                  style={{ top: h * HOUR_H }}
                >
                  {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
                </div>
              ))}
            </div>
          </div>

          {/* Day columns */}
          <div ref={colsRef} className="flex-1 flex">
            {days.map((d) => {
              const key = dateKey(d)
              const timed = (byDate[key] ?? []).filter((e) => !e.allDay && e.id !== drag?.event.id)
              const placed = layoutDayEvents(timed, HOUR_H)
              return (
                <div key={key} className="flex-1 min-w-0 relative border-l border-[var(--border-color)]">
                  {/* hour lines + click/context-to-create layer */}
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-t border-[var(--border-color)]/60"
                      style={{ top: h * HOUR_H, height: HOUR_H }}
                    />
                  ))}
                  <div
                    className="absolute inset-0"
                    onPointerDown={(e) => {
                      if (e.button !== 0 || dragRef.current) return
                      createBgRef.current = e.currentTarget as HTMLElement
                      const startMin = clamp(minAtClientY(e.clientY), 0, 1440 - SNAP)
                      setCreating({ dateK: key, startMin, curMin: startMin })
                    }}
                    onMouseMove={(e) => {
                      if (dragRef.current || creatingRef.current) return
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      const startMin = clamp(
                        snap(((e.clientY - rect.top) / HOUR_H) * 60),
                        0,
                        1440 - defaultDurationMin,
                      )
                      setHover((h) =>
                        h && h.dateK === key && h.startMin === startMin ? h : { dateK: key, startMin },
                      )
                    }}
                    onMouseLeave={() => setHover((h) => (h && h.dateK === key ? null : h))}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      onSlotContext(key, slotTimeAt(e), e.clientX, e.clientY)
                    }}
                  />

                  {/* Drag-to-create range preview — translucent "appointment" block */}
                  {creating &&
                    creating.dateK === key &&
                    (() => {
                      const a = Math.min(creating.startMin, creating.curMin)
                      const b = Math.max(creating.startMin, creating.curMin)
                      const h = Math.max(SNAP, b - a)
                      return (
                        <div
                          className="absolute left-0.5 right-0.5 rounded pointer-events-none z-10 px-1.5 py-1 overflow-hidden bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                          style={{
                            top: (a / 60) * HOUR_H,
                            height: (h / 60) * HOUR_H,
                            background: 'color-mix(in srgb, var(--accent-cyan) 26%, transparent)',
                            border: '1px solid color-mix(in srgb, var(--accent-cyan) 55%, transparent)',
                          }}
                        >
                          <div className="text-[10px] font-semibold leading-tight truncate">
                            {d.toLocaleDateString(undefined, {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </div>
                          <div className="text-[10px] text-[var(--text-secondary)] leading-tight">
                            {minutesToHM(a)} – {minutesToHM(a + h)}
                          </div>
                        </div>
                      )
                    })()}

                  {/* Hover preview of the default new-event slot */}
                  {hover && hover.dateK === key && !drag && !creating && (
                    <div
                      className="absolute left-0.5 right-0.5 rounded border border-dashed border-[var(--primary-color)] bg-[var(--primary-color)]/10 pointer-events-none z-0 px-1 py-0.5"
                      style={{
                        top: (hover.startMin / 60) * HOUR_H,
                        height: (defaultDurationMin / 60) * HOUR_H,
                      }}
                    >
                      <span className="text-[10px] text-[var(--primary-color)]">
                        {minutesToHM(hover.startMin)}
                      </span>
                    </div>
                  )}

                  {/* current-time indicator */}
                  {key === todayK && (
                    <div
                      className="absolute left-0 right-0 h-px bg-red-500 z-10 pointer-events-none"
                      style={{ top: (nowMin / 60) * HOUR_H }}
                    >
                      <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500" />
                    </div>
                  )}

                  {/* events */}
                  {placed.map((p) => (
                    <EventBlock
                      key={p.event.id}
                      top={p.top}
                      height={p.height}
                      leftPct={p.leftPct}
                      widthPct={p.widthPct}
                      color={colorFor(p.event)}
                      event={p.event}
                      onPointerDownBody={(e) => startDrag(e, p.event, 'move')}
                      onPointerDownResize={(e) => startDrag(e, p.event, 'resize')}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        onEventContext(p.event, e.clientX, e.clientY)
                      }}
                    />
                  ))}

                  {/* dragged event overlay */}
                  {drag && drag.curDateK === key && (
                    <div
                      className="absolute rounded px-1 py-0.5 text-[11px] overflow-hidden pointer-events-none z-20 shadow-lg ring-1 ring-[var(--primary-color)] bg-[var(--bg-tertiary)]"
                      style={{
                        top: (drag.curStartMin / 60) * HOUR_H,
                        height: (drag.curDurMin / 60) * HOUR_H,
                        left: 2,
                        right: 2,
                        background: `color-mix(in srgb, ${colorFor(drag.event)} 40%, var(--bg-secondary))`,
                      }}
                    >
                      <div className="text-[10px] text-[var(--text-primary)] leading-tight">
                        {minutesToHM(drag.curStartMin)}–{minutesToHM(drag.curStartMin + drag.curDurMin)}
                      </div>
                      <div className="font-medium text-[var(--text-primary)] truncate">
                        {drag.event.title}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function EventBlock({
  top,
  height,
  leftPct,
  widthPct,
  color,
  event,
  onPointerDownBody,
  onPointerDownResize,
  onContextMenu,
}: {
  top: number
  height: number
  leftPct: number
  widthPct: number
  color: string
  event: CalEvent
  onPointerDownBody: (e: React.PointerEvent) => void
  onPointerDownResize: (e: React.PointerEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onPointerDown={onPointerDownBody}
      onContextMenu={onContextMenu}
      className="absolute rounded px-1 py-0.5 text-[11px] overflow-hidden cursor-grab active:cursor-grabbing select-none bg-[var(--bg-tertiary)]"
      style={{
        top,
        height: Math.max(height, 16),
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        background: `color-mix(in srgb, ${color} 28%, transparent)`,
        borderLeft: `3px solid ${color}`,
      }}
      title={`${event.time}${event.endTime ? `–${event.endTime}` : ''} ${event.title}`}
    >
      <div className="font-medium text-[var(--text-primary)] leading-tight truncate">{event.title}</div>
      {height > 28 && (
        <div className="text-[var(--text-tertiary)] truncate">
          {event.time}
          {event.endTime ? `–${event.endTime}` : ''}
          {event.location ? ` · ${event.location}` : ''}
        </div>
      )}
      {/* resize handle */}
      <div
        onPointerDown={onPointerDownResize}
        className="absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize"
      />
    </div>
  )
}
