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
  login: (server: string, username: string, password: string) => Promise<void>
  logout: () => void
  restoreSession: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      session: null,
      credentials: null,

      login: async (server, username, password) => {
        try {
          const session = await jmapClient.authenticate(server, username, password)
          set({
            isAuthenticated: true,
            session,
            credentials: { server, username, password },
          })
        } catch (error) {
          set({ isAuthenticated: false, session: null, credentials: null })
          throw error
        }
      },

      logout: () => {
        set({
          isAuthenticated: false,
          session: null,
          credentials: null,
        })
      },

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
