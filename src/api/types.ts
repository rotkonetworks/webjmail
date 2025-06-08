export interface JMAPSession {
  accounts: Record<string, Account>
  primaryAccounts: Record<string, string>
  username: string
  apiUrl: string
  downloadUrl: string
  uploadUrl: string
  eventSourceUrl: string
  state: string
}

export interface Account {
  name: string
  isPersonal: boolean
  isReadOnly: boolean
  accountCapabilities: Record<string, any>
}

export interface Mailbox {
  id: string
  name: string
  parentId: string | null
  role: string | null
  sortOrder: number
  totalEmails: number
  unreadEmails: number
  totalThreads: number
  unreadThreads: number
  myRights: {
    mayReadItems: boolean
    mayAddItems: boolean
    mayRemoveItems: boolean
    maySetSeen: boolean
    maySetKeywords: boolean
    mayCreateChild: boolean
    mayRename: boolean
    mayDelete: boolean
    maySubmit: boolean
  }
  isSubscribed: boolean
}

export interface Email {
  id: string
  blobId: string
  threadId: string
  mailboxIds: Record<string, boolean>
  keywords: Record<string, boolean>
  size: number
  receivedAt: string
  subject: string
  from: EmailAddress[] | null
  to: EmailAddress[] | null
  cc: EmailAddress[] | null
  bcc: EmailAddress[] | null
  replyTo: EmailAddress[] | null
  sentAt: string | null
  hasAttachment: boolean
  preview: string
  bodyStructure: BodyPart
  bodyValues: Record<string, BodyValue>
  textBody: BodyPart[]
  htmlBody: BodyPart[]
  attachments: BodyPart[]
}

export interface EmailAddress {
  name: string | null
  email: string
}

export interface BodyPart {
  partId: string
  blobId: string | null
  size: number
  name: string | null
  type: string
  charset: string | null
  disposition: string | null
  cid: string | null
  location: string | null
  subParts: BodyPart[] | null
}

export interface BodyValue {
  value: string
  isEncodingProblem: boolean
  isTruncated: boolean
}

export interface Thread {
  id: string
  emailIds: string[]
}
