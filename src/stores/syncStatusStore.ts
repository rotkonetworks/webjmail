import { create } from 'zustand'

// Lightweight reactive sync status: "Indexing…" while the reconcile runs, and a
// generation counter bumped when the local cache is reset so live queries
// re-subscribe to the fresh database.
interface SyncStatusState {
  indexing: boolean
  cacheGeneration: number
  setIndexing: (v: boolean) => void
  bumpCacheGeneration: () => void
}

export const useSyncStatusStore = create<SyncStatusState>((set) => ({
  indexing: false,
  cacheGeneration: 0,
  setIndexing: (indexing) => set({ indexing }),
  bumpCacheGeneration: () => set((s) => ({ cacheGeneration: s.cacheGeneration + 1 })),
}))
