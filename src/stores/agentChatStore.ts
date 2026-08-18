import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatMsg } from '../lib/agent'
import type { Turn } from '../lib/llm'

// The assistant conversation lives here (not in the AgentChat component) so it
// survives remounts — crossing the mobile/desktop breakpoint swaps the desktop
// panel for the mobile one (a fresh mount), and closing/reopening the panel
// remounts too. Local component state would be wiped each time; this isn't.
// It's also persisted to localStorage so you can pick up the conversation after
// a reload, or start fresh with "New chat".
interface AgentChatStore {
  // What the user sees (rendered bubbles).
  msgs: ChatMsg[]
  // The normalized model turns fed back into runAgent for context.
  history: Turn[]
  setMsgs: (updater: ChatMsg[] | ((m: ChatMsg[]) => ChatMsg[])) => void
  setHistory: (h: Turn[]) => void
  reset: () => void
}

export const useAgentChatStore = create<AgentChatStore>()(
  persist(
    (set) => ({
      msgs: [],
      history: [],
      setMsgs: (updater) =>
        set((s) => ({ msgs: typeof updater === 'function' ? updater(s.msgs) : updater })),
      setHistory: (history) => set({ history }),
      reset: () => set({ msgs: [], history: [] }),
    }),
    { name: 'webjmail:agent-chat' }
  )
)
