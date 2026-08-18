import { useQuery, useQueryClient } from '@tanstack/react-query'
import { jmapClient } from '../api/jmap'
import { useAuthStore } from '../stores/authStore'
import { parseJSEvent, type CalEvent } from '../lib/calendar'

export function useCalendars() {
  const session = useAuthStore((s) => s.session)
  return useQuery({
    queryKey: ['calendars'],
    queryFn: () => jmapClient.getCalendars(),
    enabled: !!session && jmapClient.supportsCalendars(),
    staleTime: 10 * 60 * 1000,
  })
}

// Events overlapping [after, before) (UTCDate ISO strings), converted into
// `displayTz`. Keyed by window + zone so switching zones re-derives correctly.
export function useCalendarRange(after: string, before: string, displayTz: string) {
  const session = useAuthStore((s) => s.session)
  const query = useQuery({
    queryKey: ['calendar-events', after, before, displayTz],
    queryFn: async (): Promise<CalEvent[]> => {
      const raw = await jmapClient.getCalendarEvents(after, before)
      return raw.map((r) => parseJSEvent(r, displayTz))
    },
    enabled: !!session && jmapClient.supportsCalendars(),
    staleTime: 60 * 1000,
  })
  return {
    events: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useCalendarMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['calendar-events'] })

  // Optimistically patch every cached window so a drag/resize is instant.
  const patchLocal = (id: string, changes: Partial<CalEvent>) => {
    qc.setQueriesData({ queryKey: ['calendar-events'] }, (data: any) => {
      if (!Array.isArray(data)) return data
      return data.map((e: CalEvent) => (e.id === id ? { ...e, ...changes } : e))
    })
  }

  return {
    create: async (event: Record<string, any>) => {
      const id = await jmapClient.createCalendarEvent(event)
      invalidate()
      return id
    },
    update: async (id: string, patch: Record<string, any>, optimistic?: Partial<CalEvent>) => {
      if (optimistic) patchLocal(id, optimistic)
      try {
        await jmapClient.updateCalendarEvent(id, patch)
      } finally {
        invalidate()
      }
    },
    remove: async (id: string) => {
      await jmapClient.deleteCalendarEvent(id)
      invalidate()
    },
  }
}
