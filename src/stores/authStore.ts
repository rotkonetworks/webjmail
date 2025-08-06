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
    token: string
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
          const token = 'Basic ' + btoa(username + ':' + password)
          
          console.log('[AuthStore] Login successful, session:', {
            username: session?.username,
            accounts: Object.keys(session?.accounts),
            capabilities: Object.keys(session?.capabilities),
            apiUrl: session?.apiUrl,
          })
          
          set({
            isAuthenticated: true,
            session,
            sessionInfo: { server, username, token },
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
        
        // Clear the JMAP client session
        jmapClient.clearSession()
        
        set({
          isAuthenticated: false,
          session: null,
          sessionInfo: null,
          error: null,
        })
      },

      clearError: () => set({ error: null }),

      restoreSession: async () => {
        const state = get()
        
        if (state.sessionInfo && state.sessionInfo.token) {
          set({ isLoading: true })
          
          try {
            console.log('[AuthStore] Restoring session for:', state.sessionInfo.username)
            
            // Restore the session using the stored token
            const session = await jmapClient.restoreSession(
              state.sessionInfo.server,
              state.sessionInfo.token
            )
            
            console.log('[AuthStore] Session restored successfully')
            
            set({
              isAuthenticated: true,
              session,
              isLoading: false,
              error: null,
            })
          } catch (error) {
            console.error('[AuthStore] Failed to restore session:', error)
            
            // Clear invalid session
            set({
              isAuthenticated: false,
              session: null,
              sessionInfo: null,
              isLoading: false,
              error: null,
            })
          }
        } else {
          if (import.meta.env.DEV) {
            console.log('[AuthStore] No stored session to restore')
          }
          set({ isLoading: false })
        }
      },
    }),
    {
      name: 'jmap-auth',
      partialize: (state) => ({
        sessionInfo: state.sessionInfo,
        isAuthenticated: state.isAuthenticated,
        session: state.session,
      }),
    }
  )
)
