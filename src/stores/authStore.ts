// src/stores/authStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { jmapClient } from '../api/jmap'
import type { JMAPSession } from '../api/types'

interface AuthState {
  isAuthenticated: boolean
  session: JMAPSession | null
  credentials: {
    server: string
    username: string
    password: string
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
      credentials: null,
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
            credentials: { server, username, password },
            isLoading: false,
            error: null,
          })
        } catch (error) {
          console.error('[AuthStore] Login failed:', error)
          
          set({
            isAuthenticated: false,
            session: null,
            credentials: null,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Login failed',
          })
          
          throw error
        }
      },

      logout: () => {
        console.log('[AuthStore] Logging out')
        
        // Don't clear IndexedDB on logout - only clear auth state
        set({
          isAuthenticated: false,
          session: null,
          credentials: null,
          error: null,
        })
      },

      clearError: () => set({ error: null }),

      restoreSession: async () => {
        const { credentials } = get()
        
        if (credentials) {
          console.log('[AuthStore] Restoring session for:', credentials.username)
          
          try {
            await get().login(credentials.server, credentials.username, credentials.password)
          } catch (error) {
            console.error('[AuthStore] Failed to restore session:', error)
            // Don't throw here, just log and continue
          }
        } else {
          console.log('[AuthStore] No stored credentials to restore')
        }
      },
    }),
    {
      name: 'jmap-auth',
      partialize: (state) => ({
        credentials: state.credentials,
      }),
    }
  )
)
