import { create } from 'zustand'

// Lightweight reactive status for the background full-index pass, so the UI can
// show "Indexing…" while the local offline-search index is being built.
interface SyncStatusState {
  indexing: boolean
  setIndexing: (v: boolean) => void
}

export const useSyncStatusStore = create<SyncStatusState>((set) => ({
  indexing: false,
  setIndexing: (indexing) => set({ indexing }),
}))
