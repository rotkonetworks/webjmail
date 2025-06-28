import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Mailbox, Email } from '../api/types'

interface MailState {
  mailboxes: Record<string, Mailbox>
  emails: Record<string, Email>
  selectedMailboxId: string | null
  selectedEmailId: string | null

  setMailboxes: (mailboxes: Mailbox[]) => void
  setEmails: (emails: Email[]) => void
  addEmails: (emails: Email[]) => void
  selectMailbox: (mailboxId: string | null) => void
  selectEmail: (emailId: string | null) => void
  updateEmail: (emailId: string, updates: Partial<Email>) => void
  deleteEmail: (emailId: string) => void
  clearEmails: () => void
}

export const useMailStore = create<MailState>()(
  immer((set) => ({
    mailboxes: {},
    emails: {},
    selectedMailboxId: null,
    selectedEmailId: null,

    setMailboxes: (mailboxes) =>
      set((state) => {
        state.mailboxes = {}
        mailboxes.forEach((mailbox) => {
          state.mailboxes[mailbox.id] = mailbox
        })
      }),

    setEmails: (emails) =>
      set((state) => {
        state.emails = {}
        emails.forEach((email) => {
          state.emails[email.id] = email
        })
      }),

    addEmails: (emails) =>
      set((state) => {
        emails.forEach((email) => {
          state.emails[email.id] = email
        })
      }),

    selectMailbox: (mailboxId) =>
      set((state) => {
        state.selectedMailboxId = mailboxId
        state.emails = {}
        state.emails = {}
        state.selectedEmailId = null
      }),

    selectEmail: (emailId) =>
      set((state) => {
        state.selectedEmailId = emailId
      }),

    updateEmail: (emailId, updates) =>
      set((state) => {
        if (state.emails[emailId]) {
          // Deep merge updates
          if (updates.keywords) {
            state.emails[emailId].keywords = {
              ...state.emails[emailId].keywords,
              ...updates.keywords,
            }
          }
          if (updates.mailboxIds) {
            state.emails[emailId].mailboxIds = {
              ...state.emails[emailId].mailboxIds,
              ...updates.mailboxIds,
            }
          }
          // Apply other updates
          Object.keys(updates).forEach((key) => {
            if (key !== 'keywords' && key !== 'mailboxIds') {
              ;(state.emails[emailId] as any)[key] = updates[key as keyof Email]
            }
          })
        }
      }),

    deleteEmail: (emailId) =>
      set((state) => {
        delete state.emails[emailId]
        if (state.selectedEmailId === emailId) {
          state.selectedEmailId = null
        }
      }),

    clearEmails: () =>
      set((state) => {
        state.emails = {}
        state.selectedEmailId = null
      }),
  }))
)
