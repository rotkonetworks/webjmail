import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type ViewMode = 'column' | 'row'
type Theme = 'system' | 'dark' | 'light'
type Font = 'system' | 'mono' | 'serif'

interface UIState {
  sidebarOpen: boolean
  messageListWidth: number
  loading: boolean
  error: string | null
  viewMode: ViewMode
  theme: Theme
  font: Font
  
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setMessageListWidth: (width: number) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setViewMode: (mode: ViewMode) => void
  setTheme: (theme: Theme) => void
  setFont: (font: Font) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      messageListWidth: 320,
      loading: false,
      error: null,
      viewMode: 'column',
      theme: 'system',
      font: 'system',
      
      toggleSidebar: () =>
        set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      
      setMessageListWidth: (messageListWidth) => set({ messageListWidth }),
      
      setLoading: (loading) => set({ loading }),
      
      setError: (error) => set({ error }),
      
      setViewMode: (viewMode) => set({ viewMode }),
      
      setTheme: (theme) => set({ theme }),
      
      setFont: (font) => set({ font }),
    }),
    {
      name: 'ui-settings',
      partialize: (state) => ({
        viewMode: state.viewMode,
        sidebarOpen: state.sidebarOpen,
        theme: state.theme,
        font: state.font,
      }),
    }
  )
)
