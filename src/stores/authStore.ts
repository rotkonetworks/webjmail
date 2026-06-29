// src/stores/authStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { jmapClient } from '../api/jmap'
import { isTauri } from '../lib/tauri'
import { candidateServers } from '../lib/discovery'
import { useMailStore } from './mailStore'
import { useSearchStore } from './searchStore'
import { toast } from './toastStore'
import type { JMAPSession } from '../api/types'

export interface AccountInfo {
  name: string
  server: string
  username: string
}

// Browser/web multi-account store. The desktop build keeps accounts in the Rust
// age vault (passwords never enter JS); the browser has no vault, so accounts —
// including their Basic token, exactly like the existing single-session token —
// live in localStorage.
const WEB_ACCOUNTS_KEY = 'webjmail:accounts'
interface WebAccount {
  name: string
  server: string
  username: string
  token: string
}
function loadWebAccounts(): WebAccount[] {
  try {
    return JSON.parse(localStorage.getItem(WEB_ACCOUNTS_KEY) || '[]')
  } catch {
    return []
  }
}
function saveWebAccounts(list: WebAccount[]) {
  try {
    localStorage.setItem(WEB_ACCOUNTS_KEY, JSON.stringify(list))
  } catch {
    /* ignore storage errors */
  }
}
function upsertWebAccount(a: WebAccount) {
  const list = loadWebAccounts()
  const i = list.findIndex((x) => x.name === a.name)
  if (i >= 0) list[i] = a
  else list.push(a)
  saveWebAccounts(list)
}
function removeWebAccount(name: string) {
  saveWebAccounts(loadWebAccounts().filter((a) => a.name !== name))
}

interface AuthState {
  isAuthenticated: boolean
  session: JMAPSession | null
  sessionInfo: {
    server: string
    username: string
    token: string
  } | null
  // Multi-account (desktop): all configured accounts + the active one.
  accounts: AccountInfo[]
  activeAccount: string | null
  isLoading: boolean
  error: string | null
  login: (server: string, username: string, password: string) => Promise<void>
  // Autodiscover the server from the email, then authenticate. Returns the
  // server URL that worked, or null if none of the candidates authenticated
  // (caller then falls back to the manual form).
  loginAuto: (email: string, password: string) => Promise<string | null>
  // Add a second/Nth account from the UI (keeps the current one signed in).
  addAccount: (server: string, username: string, password: string, name?: string) => Promise<void>
  // Add an account by email with server autodiscovery; returns the server that
  // worked, or null (caller then asks for the server manually).
  addAccountAuto: (email: string, password: string) => Promise<string | null>
  removeAccount: (name: string) => Promise<void>
  logout: () => void
  restoreSession: () => Promise<void>
  loadAccounts: () => Promise<void>
  switchAccount: (name: string, opts?: { quiet?: boolean }) => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      session: null,
      sessionInfo: null,
      accounts: [],
      activeAccount: null,
      isLoading: false,
      error: null,

      loadAccounts: async () => {
        if (!isTauri) {
          const web = loadWebAccounts()
          const current = get().session?.username
          const active =
            web.find((a) => a.username === current)?.name || get().activeAccount || web[0]?.name || null
          set({
            accounts: web.map((a) => ({ name: a.name, server: a.server, username: a.username })),
            activeAccount: active,
          })
          return
        }
        try {
          const accounts = await jmapClient.listAccounts()
          const current = get().session?.username
          const active =
            accounts.find((a) => a.username === current)?.name || accounts[0]?.name || null
          set({ accounts, activeAccount: active })
        } catch (error) {
          if (import.meta.env.DEV) console.error('[AuthStore] loadAccounts failed:', error)
        }
      },

      switchAccount: async (name, opts) => {
        if (name === get().activeAccount) return
        const quiet = opts?.quiet === true
        // Quiet switch (opening a message from the unified inbox): swap the
        // account context silently — no toast, and DON'T reset the
        // mailbox/search selection, so the unified view stays put. Reads,
        // replies, and mark-as-read then use the correct account automatically.
        if (!quiet) set({ isLoading: true, error: null })
        try {
          let session
          if (isTauri) {
            session = await jmapClient.switchAccount(name)
          } else {
            const acct = loadWebAccounts().find((a) => a.name === name)
            if (!acct) throw new Error('Unknown account')
            session = await jmapClient.restoreSession(acct.server, acct.token)
            set({ sessionInfo: { server: acct.server, username: acct.username, token: acct.token } })
          }
          if (!quiet) {
            useMailStore.getState().selectMailbox(null)
            useSearchStore.getState().setQuery('')
          }
          set({ session, activeAccount: name, isAuthenticated: true, isLoading: false })
          if (!quiet) toast.success(`Switched to ${name}`)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to switch account'
          set({ isLoading: false, error: message })
          toast.error(`Couldn't switch to ${name}: ${message}`)
        }
      },

      login: async (server, username, password) => {
        set({ isLoading: true, error: null })
        
        try {
          console.log('[AuthStore] Attempting login:', { server, username })
          
          const session = await jmapClient.authenticate(server, username, password)
          // In the desktop build the secret lives in the age vault (held by
          // Rust), so we never persist a token into localStorage.
          const token = isTauri ? '' : 'Basic ' + btoa(username + ':' + password)
          
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
          // Remember the server for next time (any JMAP host, not just rotko).
          try {
            localStorage.setItem('webjmail:lastServer', server)
          } catch {
            /* ignore storage errors */
          }
          if (!isTauri) {
            upsertWebAccount({ name: username, server, username, token })
            set({ activeAccount: username })
          }
          void get().loadAccounts()
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

      loginAuto: async (email, password) => {
        set({ isLoading: true, error: null })
        const candidates = candidateServers(email)
        for (const server of candidates) {
          try {
            const session = await jmapClient.authenticate(server, email, password)
            const token = isTauri ? '' : 'Basic ' + btoa(email + ':' + password)
            set({
              isAuthenticated: true,
              session,
              sessionInfo: { server, username: email, token },
              isLoading: false,
              error: null,
            })
            try {
              localStorage.setItem('webjmail:lastServer', server)
            } catch {
              /* ignore */
            }
            if (!isTauri) {
              upsertWebAccount({ name: email, server, username: email, token })
              set({ activeAccount: email })
            }
            void get().loadAccounts()
            return server
          } catch {
            // Try the next candidate. We intentionally don't surface per-attempt
            // errors — discovery failure drops the user to the manual form.
          }
        }
        set({ isLoading: false })
        return null
      },

      addAccount: async (server, username, password, name) => {
        set({ isLoading: true, error: null })
        try {
          const acctName = (name && name.trim()) || username
          const session = await jmapClient.addAccount(server, username, password, acctName)
          const token = isTauri ? '' : 'Basic ' + btoa(username + ':' + password)
          if (!isTauri) {
            upsertWebAccount({ name: acctName, server, username, token })
          }
          // The newly added account becomes the active session.
          useMailStore.getState().selectMailbox(null)
          useSearchStore.getState().setQuery('')
          set({
            isAuthenticated: true,
            session,
            sessionInfo: { server, username, token },
            activeAccount: acctName,
            isLoading: false,
            error: null,
          })
          await get().loadAccounts()
          set({ activeAccount: acctName })
          toast.success(`Added ${acctName}`)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to add account'
          set({ isLoading: false, error: message })
          toast.error(`Couldn't add account: ${message}`)
          throw error
        }
      },

      addAccountAuto: async (email, password) => {
        set({ isLoading: true, error: null })
        const candidates = candidateServers(email)
        for (const server of candidates) {
          try {
            const session = await jmapClient.addAccount(server, email, password, email)
            const token = isTauri ? '' : 'Basic ' + btoa(email + ':' + password)
            if (!isTauri) upsertWebAccount({ name: email, server, username: email, token })
            useMailStore.getState().selectMailbox(null)
            useSearchStore.getState().setQuery('')
            set({
              isAuthenticated: true,
              session,
              sessionInfo: { server, username: email, token },
              activeAccount: email,
              isLoading: false,
              error: null,
            })
            await get().loadAccounts()
            set({ activeAccount: email })
            toast.success(`Added ${email}`)
            return server
          } catch {
            // try next candidate
          }
        }
        set({ isLoading: false })
        return null
      },

      removeAccount: async (name) => {
        try {
          await jmapClient.removeAccount(name)
          if (!isTauri) removeWebAccount(name)
          const wasActive = get().activeAccount === name
          await get().loadAccounts()
          if (wasActive) {
            const remaining = get().accounts.filter((a) => a.name !== name)
            if (remaining.length > 0) await get().switchAccount(remaining[0].name)
            else get().logout()
          }
          toast.success(`Removed ${name}`)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to remove account'
          set({ error: message })
          toast.error(`Couldn't remove account: ${message}`)
        }
      },

      logout: () => {
        if (import.meta.env.DEV) {
          console.log('[AuthStore] Logging out')
        }
        
        // Clear IndexedDB for security on logout
        indexedDB.deleteDatabase('rotko-webmail')

        // Clear the JMAP client session (also clears the Rust-side token in Tauri)
        void jmapClient.logout()
        if (!isTauri) saveWebAccounts([])

        set({
          isAuthenticated: false,
          session: null,
          sessionInfo: null,
          accounts: [],
          activeAccount: null,
          error: null,
        })
      },

      clearError: () => set({ error: null }),

      restoreSession: async () => {
        // Desktop build: decrypt the age vault and auto-authenticate. No token
        // is read from localStorage — the master key in Rust is the source of truth.
        if (isTauri) {
          set({ isLoading: true })
          try {
            const session = await jmapClient.unlock()
            if (session) {
              set({
                isAuthenticated: true,
                session,
                sessionInfo: { server: session.apiUrl, username: session.username, token: '' },
                isLoading: false,
                error: null,
              })
              // Populate the account switcher from the manifest.
              void get().loadAccounts()
            } else {
              // No stored credentials yet — fall back to the login form.
              set({ isAuthenticated: false, session: null, isLoading: false })
            }
          } catch (error) {
            console.error('[AuthStore] Vault unlock failed:', error)
            set({
              isAuthenticated: false,
              session: null,
              isLoading: false,
              error: error instanceof Error ? error.message : 'Unlock failed',
            })
          }
          return
        }

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
