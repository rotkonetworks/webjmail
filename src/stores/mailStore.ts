import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import { enableMapSet } from 'immer'
import type { Mailbox, Email } from '../api/types'
import { useSearchStore } from './searchStore'

enableMapSet()

// Guarantee the two fields the store indexes on are always objects. Emails
// fetched via some code paths (e.g. a partial Email/get) can arrive without
// `mailboxIds`/`keywords`; without this, `Object.keys(email.mailboxIds)` throws
// and takes down the whole message view.
function normalizeEmail(email: Email): Email {
  if (email.mailboxIds && email.keywords) return email
  return {
    ...email,
    mailboxIds: email.mailboxIds ?? {},
    keywords: email.keywords ?? {},
  }
}

interface MailState {
  mailboxes: Record<string, Mailbox>
  emails: Record<string, Email>
  selectedMailboxId: string | null
  selectedEmailId: string | null
  emailsByMailbox: Record<string, string[]>
  unreadCounts: Record<string, number>
  // Merged "All inboxes" view across every account (desktop multi-account).
  unifiedView: boolean

  setMailboxes: (mailboxes: Mailbox[]) => void
  setEmails: (emails: Email[]) => void
  addEmails: (emails: Email[]) => void
  selectMailbox: (mailboxId: string | null) => void
  showUnifiedInbox: () => void
  selectEmail: (emailId: string | null) => void
  updateEmail: (emailId: string, updates: Partial<Email>) => void
  deleteEmail: (emailId: string) => void
  clearEmails: () => void
  getEmailsByMailbox: (mailboxId: string) => Email[]
  getUnreadCount: (mailboxId: string) => number
}

// Last view (folder / open email / unified) survives restarts so a launch opens
// where the user left off instead of resetting to the inbox. Only these three
// ids are kept — the email/mailbox data itself comes from the IndexedDB cache.
const VIEW_KEY = 'webjmail:last-view'
type LastView = Pick<MailState, 'selectedMailboxId' | 'selectedEmailId' | 'unifiedView'>
function loadLastView(): LastView {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null')
    if (v && typeof v === 'object') {
      return {
        selectedMailboxId: typeof v.selectedMailboxId === 'string' ? v.selectedMailboxId : null,
        selectedEmailId: typeof v.selectedEmailId === 'string' ? v.selectedEmailId : null,
        unifiedView: v.unifiedView === true,
      }
    }
  } catch {
    /* ignore storage errors */
  }
  return { selectedMailboxId: null, selectedEmailId: null, unifiedView: false }
}
const lastView = loadLastView()

export const useMailStore = create<MailState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      mailboxes: {},
      emails: {},
      selectedMailboxId: lastView.selectedMailboxId,
      selectedEmailId: lastView.selectedEmailId,
      emailsByMailbox: {},
      unreadCounts: {},
      unifiedView: lastView.unifiedView,

      setMailboxes: (mailboxes) =>
        set((state) => {
          state.mailboxes = {}
          mailboxes.forEach((mailbox) => {
            state.mailboxes[mailbox.id] = mailbox
            state.unreadCounts[mailbox.id] = mailbox.unreadEmails
          })
        }),

      setEmails: (emails) =>
        set((state) => {
          state.emails = {}
          state.emailsByMailbox = {}

          emails.forEach((raw) => {
            const email = normalizeEmail(raw)
            state.emails[email.id] = email

            Object.keys(email.mailboxIds).forEach((mailboxId) => {
              if (!state.emailsByMailbox[mailboxId]) {
                state.emailsByMailbox[mailboxId] = []
              }
              if (!state.emailsByMailbox[mailboxId].includes(email.id)) {
                state.emailsByMailbox[mailboxId].push(email.id)
              }
            })
          })
        }),

      addEmails: (emails) =>
        set((state) => {
          emails.forEach((raw) => {
            const email = normalizeEmail(raw)
            const existing = state.emails[email.id]
            state.emails[email.id] = email

            Object.keys(email.mailboxIds).forEach((mailboxId) => {
              if (!state.emailsByMailbox[mailboxId]) {
                state.emailsByMailbox[mailboxId] = []
              }
              if (!state.emailsByMailbox[mailboxId].includes(email.id)) {
                state.emailsByMailbox[mailboxId].push(email.id)
              }
            })

            if (!existing || existing.keywords.$seen !== email.keywords.$seen) {
              Object.keys(email.mailboxIds).forEach((mailboxId) => {
                const current = state.unreadCounts[mailboxId] || 0
                if (!existing && !email.keywords.$seen) {
                  state.unreadCounts[mailboxId] = current + 1
                } else if (existing && existing.keywords.$seen !== email.keywords.$seen) {
                  state.unreadCounts[mailboxId] = email.keywords.$seen
                    ? Math.max(0, current - 1)
                    : current + 1
                }
              })
            }
          })
        }),

      selectMailbox: (mailboxId) => {
        const changed = get().selectedMailboxId !== mailboxId || get().unifiedView
        set((state) => {
          // Choosing a real mailbox leaves the unified view.
          if (mailboxId !== null) state.unifiedView = false
          if (state.selectedMailboxId !== mailboxId) {
            state.selectedMailboxId = mailboxId
            state.emails = {}
            state.selectedEmailId = null
            state.emailsByMailbox = {}
          }
        })
        // A folder switch starts a fresh view — drop any active search filter so
        // the new folder isn't shown filtered by the previous query.
        if (changed) useSearchStore.getState().setQuery('')
      },

      showUnifiedInbox: () => {
        set((state) => {
          state.unifiedView = true
          state.selectedMailboxId = null
          state.selectedEmailId = null
          state.emails = {}
          state.emailsByMailbox = {}
        })
        useSearchStore.getState().setQuery('')
      },

      selectEmail: (emailId) =>
        set((state) => {
          if (state.selectedEmailId !== emailId) {
            state.selectedEmailId = emailId
          }
        }),

      updateEmail: (emailId, updates) =>
        set((state) => {
          if (state.emails[emailId]) {
            const email = state.emails[emailId]

            if (updates.keywords) {
              email.keywords = { ...email.keywords, ...updates.keywords }

              if ('$seen' in updates.keywords) {
                Object.keys(email.mailboxIds ?? {}).forEach((mailboxId) => {
                  const current = state.unreadCounts[mailboxId] || 0
                  state.unreadCounts[mailboxId] = updates.keywords!.$seen 
                    ? Math.max(0, current - 1) 
                    : current + 1
                })
              }
            }

            if (updates.mailboxIds) {
              email.mailboxIds = { ...email.mailboxIds, ...updates.mailboxIds }
            }

            Object.keys(updates).forEach((key) => {
              if (key !== 'keywords' && key !== 'mailboxIds') {
                ;(email as any)[key] = updates[key as keyof Email]
              }
            })
          }
        }),

      deleteEmail: (emailId) =>
        set((state) => {
          const email = state.emails[emailId]
          if (email) {
            Object.keys(email.mailboxIds ?? {}).forEach((mailboxId) => {
              const emailList = state.emailsByMailbox[mailboxId]
              if (emailList) {
                const index = emailList.indexOf(emailId)
                if (index > -1) {
                  emailList.splice(index, 1)
                }
              }

              if (!email.keywords?.$seen) {
                const current = state.unreadCounts[mailboxId] || 0
                state.unreadCounts[mailboxId] = Math.max(0, current - 1)
              }
            })

            delete state.emails[emailId]

            if (state.selectedEmailId === emailId) {
              state.selectedEmailId = null
            }
          }
        }),

      clearEmails: () =>
        set((state) => {
          state.emails = {}
          state.selectedEmailId = null
          state.emailsByMailbox = {}
        }),

      getEmailsByMailbox: (mailboxId: string) => {
        const state = get()
        const emailIds = state.emailsByMailbox[mailboxId]
        if (!emailIds || emailIds.length === 0) return []

        return emailIds
          .map(id => state.emails[id])
          .filter(Boolean)
          .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
      },

      getUnreadCount: (mailboxId: string) => {
        const state = get()
        return state.unreadCounts[mailboxId] || 0
      },
    }))
  )
)

useMailStore.subscribe(
  (state): LastView => ({
    selectedMailboxId: state.selectedMailboxId,
    selectedEmailId: state.selectedEmailId,
    unifiedView: state.unifiedView,
  }),
  (view) => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view))
    } catch {
      /* ignore storage errors */
    }
  },
  {
    equalityFn: (a, b) =>
      a.selectedMailboxId === b.selectedMailboxId &&
      a.selectedEmailId === b.selectedEmailId &&
      a.unifiedView === b.unifiedView,
  }
)

if (import.meta.env.DEV) {
  useMailStore.subscribe(
    (state) => state.emails,
    (emails) => {
      console.log('[MailStore] Emails updated:', Object.keys(emails).length)
    },
    { equalityFn: (a, b) => Object.keys(a).length === Object.keys(b).length }
  )
}
