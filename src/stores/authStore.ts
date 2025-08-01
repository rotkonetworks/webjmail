// src/stores/authStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { jmapClient } from '../api/jmap'
import type { JMAPSession } from '../api/types'

interface AuthState {
  isAuthenticated: boolean
  session: JMAPSession | null
  sessionInfo: {
    server: string
    username: string
  } | null
  isLoading: boolean
  error: string | null
  login: (server: string, username: string, password: string) => Promise<void>
  logout: () => void
  restoreSession: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      session: null,
      sessionInfo: null,
      isLoading: false,
      error: null,

      login: async (server, username, password) => {
        set({ isLoading: true, error: null })
        
        try {
          console.log('[AuthStore] Attempting login:', { server, username })
          
          const session = await jmapClient.authenticate(server, username, password)
          
          console.log('[AuthStore] Login successful, session:', {
            username: session.username,
            accounts: Object.keys(session.accounts),
            capabilities: Object.keys(session.capabilities),
            apiUrl: session.apiUrl,
          })
          
          set({
            isAuthenticated: true,
            session,
            sessionInfo: { server, username },
            isLoading: false,
            error: null,
          })
        } catch (error) {
          console.error('[AuthStore] Login failed:', error)
          
          set({
            isAuthenticated: false,
            session: null,
            sessionInfo: null,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Login failed',
          })
          
          throw error
        }
      },

      logout: () => {
        if (import.meta.env.DEV) {
          console.log('[AuthStore] Logging out')
        }
        
        // Clear IndexedDB for security on logout
        indexedDB.deleteDatabase('rotko-webmail')
        
        set({
          isAuthenticated: false,
          session: null,
          sessionInfo: null,
          error: null,
        })
      },

      clearError: () => set({ error: null }),

      restoreSession: async () => {
        const { sessionInfo } = get()
        
        if (sessionInfo) {
          if (import.meta.env.DEV) {
            console.log('[AuthStore] Session info found, but auto-login disabled for security')
          }
          // For security, we no longer automatically restore sessions
          // User must re-authenticate after browser restart
          set({ sessionInfo: null })
        } else {
          if (import.meta.env.DEV) {
            console.log('[AuthStore] No stored session info to restore')
          }
        }
      },
    }),
    {
      name: 'jmap-auth',
      partialize: (state) => ({
        sessionInfo: state.sessionInfo,
      }),
    }
  )
)
