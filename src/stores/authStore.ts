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
          const session = await jmapClient.authenticate(server, username, password)
          set({
            isAuthenticated: true,
            session,
            credentials: { server, username, password },
            isLoading: false,
            error: null,
          })
        } catch (error) {
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
          try {
            await get().login(
              credentials.server,
              credentials.username,
              credentials.password
            )
          } catch (error) {
            console.error('Failed to restore session:', error)
            // Don't throw here, just log and continue
          }
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
