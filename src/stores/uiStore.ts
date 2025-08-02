// src/stores/uiStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type ViewMode = 'column' | 'row'
type Theme = 'system' | 'dark' | 'light'
type Font = 'system' | 'mono' | 'serif'
type ComposerMode = 'popup' | 'inline' | 'facebook'

interface UIState {
  sidebarOpen: boolean
  messageListWidth: number
  loading: boolean
  error: string | null
  viewMode: ViewMode
  theme: Theme
  font: Font
  composerMode: ComposerMode
  minimizedComposers: string[] // Track minimized composer IDs
  
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setMessageListWidth: (width: number) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setViewMode: (mode: ViewMode) => void
  setTheme: (theme: Theme) => void
  setFont: (font: Font) => void
  setComposerMode: (mode: ComposerMode) => void
  addMinimizedComposer: (id: string) => void
  removeMinimizedComposer: (id: string) => void
  clearMinimizedComposers: () => void
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
      composerMode: 'inline', // Default to inline like Gmail
      minimizedComposers: [],
      
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setMessageListWidth: (messageListWidth) => set({ messageListWidth }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      setViewMode: (viewMode) => set({ viewMode }),
      setTheme: (theme) => set({ theme }),
      setFont: (font) => set({ font }),
      setComposerMode: (composerMode) => set({ composerMode }),
      addMinimizedComposer: (id) => set((state) => ({
        minimizedComposers: [...state.minimizedComposers, id]
      })),
      removeMinimizedComposer: (id) => set((state) => ({
        minimizedComposers: state.minimizedComposers.filter(cid => cid !== id)
      })),
      clearMinimizedComposers: () => set({ minimizedComposers: [] }),
    }),
    {
      name: 'ui-settings',
      partialize: (state) => ({
        viewMode: state.viewMode,
        sidebarOpen: state.sidebarOpen,
        theme: state.theme,
        font: state.font,
        composerMode: state.composerMode,
      }),
    }
  )
)
