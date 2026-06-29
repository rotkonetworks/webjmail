// A single "active draft" shared between the composer UI and the AI assistant.
// The composer is a controlled component bound to this store, so when the
// assistant edits the draft (update_draft tool) the open composer updates live,
// and when the user types, the assistant can read the current draft back.
import { create } from 'zustand'

export type DraftMode = 'compose' | 'reply' | 'replyAll' | 'forward'

export interface DraftFields {
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
  replyToId?: string
  mode: DraftMode
}

interface DraftStore extends DraftFields {
  open: boolean
  // rev bumps whenever the ASSISTANT changes the draft, so the composer can
  // flash/scroll to show the user what changed. User edits don't bump it.
  rev: number
  // Open a fresh draft (replaces any current one).
  openDraft: (d: Partial<DraftFields>) => void
  // User-side edit from the composer inputs (no rev bump).
  setField: (patch: Partial<DraftFields>) => void
  // Assistant-side edit (merges + bumps rev).
  applyAgentEdit: (patch: Partial<DraftFields>) => void
  close: () => void
}

const EMPTY: DraftFields = {
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  body: '',
  replyToId: undefined,
  mode: 'compose',
}

export const useDraftStore = create<DraftStore>((set) => ({
  ...EMPTY,
  open: false,
  rev: 0,
  openDraft: (d) =>
    set((s) => ({ ...EMPTY, ...d, open: true, rev: s.rev + 1 })),
  setField: (patch) => set((s) => ({ ...s, ...patch })),
  applyAgentEdit: (patch) =>
    set((s) => ({ ...s, ...patch, open: true, rev: s.rev + 1 })),
  close: () => set({ ...EMPTY, open: false }),
}))

// Read the current draft as plain fields (for the assistant's read tool).
export function draftSnapshot(): DraftFields & { open: boolean } {
  const s = useDraftStore.getState()
  return {
    open: s.open,
    to: s.to,
    cc: s.cc,
    bcc: s.bcc,
    subject: s.subject,
    body: s.body,
    replyToId: s.replyToId,
    mode: s.mode,
  }
}
