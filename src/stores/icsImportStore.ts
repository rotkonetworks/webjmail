import { create } from 'zustand'

// Queue of iCalendar payloads waiting for the user to import — fed by files the
// OS hands the desktop app (double-click an .ics) and by .ics mail attachments.
export interface IcsImportRequest {
  text: string
  source: string // file name or attachment name, for the dialog header
}

interface IcsImportState {
  queue: IcsImportRequest[]
  open: (req: IcsImportRequest) => void
  next: () => void
}

export const useIcsImportStore = create<IcsImportState>((set) => ({
  queue: [],
  open: (req) => set((s) => ({ queue: [...s.queue, req] })),
  next: () => set((s) => ({ queue: s.queue.slice(1) })),
}))
