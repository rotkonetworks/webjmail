import { useState } from 'react'
import { useCalendarMutations } from '../../hooks/useCalendar'
import {
  buildStartLocal,
  hmToMinutes,
  minutesToDuration,
  minutesToHM,
  type CalEvent,
} from '../../lib/calendar'
import { useCalendarStore } from '../../stores/calendarStore'
import { toast } from '../../stores/toastStore'

interface Props {
  calendars: Array<{ id: string; name: string; color?: string }>
  event?: CalEvent | null
  initial?: { date?: string; time?: string; endTime?: string }
  onClose: () => void
  onSaved: () => void
}

const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function EventComposer({ calendars, event, initial, onClose, onSaved }: Props) {
  const { create, update, remove } = useCalendarMutations()
  const displayTz = useCalendarStore((s) => s.displayTz)
  const defaultDurationMin = useCalendarStore((s) => s.defaultDurationMin)
  const editing = !!event

  const [title, setTitle] = useState(event?.title === '(no title)' ? '' : event?.title ?? '')
  const [allDay, setAllDay] = useState(event?.allDay ?? false)
  const [date, setDate] = useState(event?.date || initial?.date || todayKey())
  const [startTime, setStartTime] = useState(event?.time || initial?.time || '09:00')
  const [endTime, setEndTime] = useState(
    event?.endTime ||
      initial?.endTime ||
      minutesToHM(hmToMinutes(event?.time || initial?.time || '09:00') + defaultDurationMin)
  )
  const [calendarId, setCalendarId] = useState(event?.calendarId || calendars[0]?.id || '')
  const [location, setLocation] = useState(event?.location ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!calendarId) {
      toast.error('No calendar to save into')
      return
    }
    let durationMin: number
    if (allDay) durationMin = 1440
    else {
      durationMin = hmToMinutes(endTime) - hmToMinutes(startTime)
      if (durationMin <= 0) durationMin += 1440 // end past midnight
    }
    const fields: Record<string, any> = {
      title: title.trim() || '(no title)',
      start: buildStartLocal(date, allDay ? '00:00' : startTime),
      duration: minutesToDuration(durationMin),
      timeZone: allDay ? null : displayTz,
      showWithoutTime: allDay,
      locations: location.trim() ? { '1': { '@type': 'Location', name: location.trim() } } : null,
      description: description.trim() || null,
    }
    setBusy(true)
    try {
      if (editing) {
        if (event!.calendarId !== calendarId) fields.calendarIds = { [calendarId]: true }
        await update(event!.id, fields)
      } else {
        await create({ '@type': 'Event', calendarIds: { [calendarId]: true }, ...fields })
      }
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save event')
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (!event || !confirm('Delete this event?')) return
    setBusy(true)
    try {
      await remove(event.id)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete event')
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full text-sm bg-transparent border-b border-[var(--border-color)] focus:border-[var(--primary-color)] outline-none py-1.5'

  return (
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[var(--bg-secondary)] rounded-lg shadow-2xl border border-[var(--border-color)] flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            void save()
          }
        }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            {editing ? 'Edit event' : 'New event'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
            <div className="i-lucide:x text-sm" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add title"
            className="w-full text-lg bg-transparent border-b border-[var(--border-color)] focus:border-[var(--primary-color)] outline-none py-1.5 text-[var(--text-primary)]"
          />

          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            All day
          </label>

          <div className="flex items-center gap-2">
            <div className="i-lucide:clock text-[var(--text-tertiary)]" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
            {!allDay && (
              <>
                <input
                  type="time"
                  lang="en-GB"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={field}
                />
                <span className="text-[var(--text-tertiary)]">–</span>
                <input
                  type="time"
                  lang="en-GB"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={field}
                />
              </>
            )}
          </div>

          {calendars.length > 1 && (
            <div className="flex items-center gap-2">
              <div className="i-lucide:calendar text-[var(--text-tertiary)]" />
              <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} className={field}>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="i-lucide:map-pin text-[var(--text-tertiary)]" />
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Location"
              className={field}
            />
          </div>

          <div className="flex items-start gap-2">
            <div className="i-lucide:align-left text-[var(--text-tertiary)] mt-2" />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              rows={3}
              className="w-full text-sm bg-transparent border-b border-[var(--border-color)] focus:border-[var(--primary-color)] outline-none py-1.5 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between p-4 border-t border-[var(--border-color)]">
          {editing ? (
            <button
              onClick={del}
              disabled={busy}
              className="px-3 py-1.5 text-sm text-red-400 hover:bg-[var(--bg-tertiary)] rounded disabled:opacity-50"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm hover:bg-[var(--bg-tertiary)] rounded">
              Cancel
            </button>
            <button onClick={save} disabled={busy} className="btn-primary px-4 py-1.5 text-sm rounded flex items-center gap-1.5">
              {busy && <div className="i-eos-icons:loading animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
