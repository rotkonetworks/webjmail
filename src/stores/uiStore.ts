import { create } from 'zustand'

interface UIState {
  sidebarOpen: boolean
  messageListWidth: number
  loading: boolean
  error: string | null
  
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setMessageListWidth: (width: number) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  messageListWidth: 320,
  loading: false,
  error: null,

  toggleSidebar: () =>
    set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  
  setMessageListWidth: (messageListWidth) => set({ messageListWidth }),
  
  setLoading: (loading) => set({ loading }),
  
  setError: (error) => set({ error }),
}))
