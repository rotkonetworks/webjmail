import { create } from 'zustand'

// Per-account inbox unread counts, surfaced as badges in the sidebar/switcher.
// Written by useUnifiedInbox; seeded from the unified offline cache so badges
// appear immediately on launch (before the first refresh completes).
export const UNIFIED_CACHE_KEY = 'webjmail:unified-cache'

function seed(): Record<string, number> {
  try {
    const raw = localStorage.getItem(UNIFIED_CACHE_KEY)
    return raw ? (JSON.parse(raw).unreadByAccount ?? {}) : {}
  } catch {
    return {}
  }
}

interface UnreadState {
  byAccount: Record<string, number>
  setByAccount: (m: Record<string, number>) => void
}

export const useUnreadStore = create<UnreadState>((set) => ({
  byAccount: seed(),
  setByAccount: (byAccount) => set({ byAccount }),
}))
