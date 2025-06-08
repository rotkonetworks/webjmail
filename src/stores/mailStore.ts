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
  selectMailbox: (mailboxId: string | null) => void
  selectEmail: (emailId: string | null) => void
  updateEmail: (emailId: string, updates: Partial<Email>) => void
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
        emails.forEach((email) => {
          state.emails[email.id] = email
        })
      }),

    selectMailbox: (mailboxId) =>
      set((state) => {
        state.selectedMailboxId = mailboxId
        state.selectedEmailId = null
      }),

    selectEmail: (emailId) =>
      set((state) => {
        state.selectedEmailId = emailId
      }),

    updateEmail: (emailId, updates) =>
      set((state) => {
        if (state.emails[emailId]) {
          Object.assign(state.emails[emailId], updates)
        }
      }),
  }))
)
