import { useMemo } from 'react'
import {
  monthGrid,
  groupByDate,
  dateKey,
  parseDateKey,
  WEEKDAYS,
  type CalEvent,
} from '../../lib/calendar'
import { cn } from '../../lib/cn'

interface Props {
  cursor: string
  events: CalEvent[]
  colorFor: (e: CalEvent) => string
  onOpenEvent: (e: CalEvent) => void
  onEventContext: (e: CalEvent, x: number, y: number) => void
  onOpenDay: (dateK: string) => void
  onDayContext: (dateK: string, x: number, y: number) => void
}

export function MonthView({
  cursor,
  events,
  colorFor,
  onOpenEvent,
  onEventContext,
  onOpenDay,
  onDayContext,
}: Props) {
  const ref = parseDateKey(cursor)
  const year = ref.getFullYear()
  const month = ref.getMonth()
  const grid = useMemo(() => monthGrid(year, month), [year, month])
  const byDate = useMemo(() => groupByDate(events), [events])
  const todayK = dateKey(new Date())

  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-7 border-b border-[var(--border-color)]">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-1.5 text-xs font-medium text-[var(--text-tertiary)] text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="flex-1 grid grid-cols-7 grid-rows-6">
        {grid.map((d) => {
          const key = dateKey(d)
          const inMonth = d.getMonth() === month
          const isToday = key === todayK
          const dayEvents = byDate[key] ?? []
          return (
            <div
              key={key}
              onClick={() => onOpenDay(key)}
              onContextMenu={(e) => {
                e.preventDefault()
                onDayContext(key, e.clientX, e.clientY)
              }}
              className={cn(
                'border-b border-r border-[var(--border-color)] p-1 overflow-hidden flex flex-col gap-0.5 cursor-pointer hover:bg-[var(--bg-tertiary)]',
                !inMonth && 'bg-[var(--bg-secondary)]/40',
              )}
            >
              <div
                className={cn(
                  'text-xs flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full',
                  isToday && 'bg-[var(--primary-color)] text-[var(--on-primary)] font-semibold',
                  !isToday && inMonth && 'text-[var(--text-primary)]',
                  !isToday && !inMonth && 'text-[var(--text-tertiary)]',
                )}
              >
                {d.getDate()}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map((e) => (
                  <div
                    key={e.id}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onOpenEvent(e)
                    }}
                    onContextMenu={(ev) => {
                      ev.preventDefault()
                      ev.stopPropagation()
                      onEventContext(e, ev.clientX, ev.clientY)
                    }}
                    className="flex items-center gap-1 text-[10px] leading-tight truncate rounded px-1 py-0.5 hover:brightness-110 bg-[var(--bg-tertiary)]"
                    style={{ background: `color-mix(in srgb, ${colorFor(e)} 22%, transparent)` }}
                    title={`${e.time ? e.time + ' ' : ''}${e.title}`}
                  >
                    {!e.allDay && (
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: colorFor(e) }} />
                    )}
                    <span className="truncate text-[var(--text-primary)]">
                      {e.time ? `${e.time} ` : ''}
                      {e.title}
                    </span>
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-[var(--text-tertiary)] px-1">+{dayEvents.length - 3} more</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
