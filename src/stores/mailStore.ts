import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import { enableMapSet } from 'immer'
import type { Mailbox, Email } from '../api/types'

enableMapSet()

interface MailState {
  mailboxes: Record<string, Mailbox>
  emails: Record<string, Email>
  selectedMailboxId: string | null
  selectedEmailId: string | null
  emailsByMailbox: Record<string, string[]>
  unreadCounts: Record<string, number>

  setMailboxes: (mailboxes: Mailbox[]) => void
  setEmails: (emails: Email[]) => void
  addEmails: (emails: Email[]) => void
  selectMailbox: (mailboxId: string | null) => void
  selectEmail: (emailId: string | null) => void
  updateEmail: (emailId: string, updates: Partial<Email>) => void
  deleteEmail: (emailId: string) => void
  clearEmails: () => void
  getEmailsByMailbox: (mailboxId: string) => Email[]
  getUnreadCount: (mailboxId: string) => number
}

export const useMailStore = create<MailState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      mailboxes: {},
      emails: {},
      selectedMailboxId: null,
      selectedEmailId: null,
      emailsByMailbox: {},
      unreadCounts: {},

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

          emails.forEach((email) => {
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
          emails.forEach((email) => {
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

      selectMailbox: (mailboxId) =>
        set((state) => {
          if (state.selectedMailboxId !== mailboxId) {
            state.selectedMailboxId = mailboxId
            state.emails = {}
            state.selectedEmailId = null
            state.emailsByMailbox = {}
          }
        }),

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
                Object.keys(email.mailboxIds).forEach((mailboxId) => {
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
            Object.keys(email.mailboxIds).forEach((mailboxId) => {
              const emailList = state.emailsByMailbox[mailboxId]
              if (emailList) {
                const index = emailList.indexOf(emailId)
                if (index > -1) {
                  emailList.splice(index, 1)
                }
              }

              if (!email.keywords.$seen) {
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

if (import.meta.env.DEV) {
  useMailStore.subscribe(
    (state) => state.emails,
    (emails) => {
      console.log('[MailStore] Emails updated:', Object.keys(emails).length)
    },
    { equalityFn: (a, b) => Object.keys(a).length === Object.keys(b).length }
  )
}
