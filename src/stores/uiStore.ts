// src/stores/uiStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type ViewMode = 'column' | 'row'
type Theme = 'system' | 'dark' | 'light'
type Font = 'system' | 'mono' | 'serif'
type ComposerMode = 'inline'
type ImageLoadingMode = 'always' | 'ask' | 'never'
type HtmlRichness = 'minimal' | 'rich'

interface UIState {
  sidebarOpen: boolean
  sidebarWidth: number
  messageListWidth: number
  loading: boolean
  error: string | null
  viewMode: ViewMode
  theme: Theme
  font: Font
  composerMode: ComposerMode
  imageLoadingMode: ImageLoadingMode
  htmlRichness: HtmlRichness
  minimizedComposers: string[] // track minimized composer IDs
  
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSidebarWidth: (width: number) => void
  setMessageListWidth: (width: number) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setViewMode: (mode: ViewMode) => void
  setTheme: (theme: Theme) => void
  setFont: (font: Font) => void
  setImageLoadingMode: (mode: ImageLoadingMode) => void
  setHtmlRichness: (richness: HtmlRichness) => void
  addMinimizedComposer: (id: string) => void
  removeMinimizedComposer: (id: string) => void
  clearMinimizedComposers: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarWidth: 240,
      messageListWidth: 320,
      loading: false,
      error: null,
      viewMode: 'column',
      theme: 'system',
      font: 'system',
      composerMode: 'inline', // Only inline mode supported
      imageLoadingMode: 'ask', // Default to privacy-conscious mode
      htmlRichness: 'rich', // Default to rich HTML
      minimizedComposers: [],
      
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setMessageListWidth: (messageListWidth) => set({ messageListWidth }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      setViewMode: (viewMode) => set({ viewMode }),
      setTheme: (theme) => set({ theme }),
      setFont: (font) => set({ font }),
      setImageLoadingMode: (imageLoadingMode) => set({ imageLoadingMode }),
      setHtmlRichness: (htmlRichness) => set({ htmlRichness }),
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
        sidebarWidth: state.sidebarWidth,
        messageListWidth: state.messageListWidth,
        theme: state.theme,
        font: state.font,
        imageLoadingMode: state.imageLoadingMode,
        htmlRichness: state.htmlRichness,
      }),
    }
  )
)
