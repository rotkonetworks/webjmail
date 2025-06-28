// Core JMAP Types
export interface JMAPSession {
  accounts: Record<string, Account>
  primaryAccounts: Record<string, string>
  username: string
  apiUrl: string
  downloadUrl: string
  uploadUrl: string
  eventSourceUrl: string
  state: string
  capabilities: Record<string, any>
}

export interface Account {
  name: string
  isPersonal: boolean
  isReadOnly: boolean
  accountCapabilities: Record<string, any>
}

// Request/Response Types
export interface JMAPRequest {
  using: string[]
  methodCalls: Array<[string, any, string]>
  createdIds?: Record<string, string>
}

export interface JMAPResponse {
  methodResponses: Array<[string, any, string]>
  createdIds?: Record<string, string>
  sessionState: string
}

export interface JMAPError {
  type: string
  description?: string
  properties?: string[]
}

// Mailbox Types
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

// Email Types
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
  // Additional properties
  messageId?: string[]
  inReplyTo?: string[]
  references?: string[]
  sender?: EmailAddress[]
  headers?: EmailHeader[]
}

export interface EmailAddress {
  name: string | null
  email: string
}

export interface EmailHeader {
  name: string
  value: string
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
  // Additional properties
  language?: string[]
  headers?: EmailHeader[]
}

export interface BodyValue {
  value: string
  isEncodingProblem: boolean
  isTruncated: boolean
}

// Thread Types
export interface Thread {
  id: string
  emailIds: string[]
}

// Query Types
export interface EmailQuery {
  accountId: string
  filter?: EmailFilter
  sort?: EmailSort[]
  position?: number
  anchor?: string
  anchorOffset?: number
  limit?: number
  calculateTotal?: boolean
}

export interface EmailFilter {
  operator?: 'AND' | 'OR' | 'NOT'
  conditions?: EmailFilter[]
  inMailbox?: string
  inMailboxOtherThan?: string[]
  before?: string
  after?: string
  minSize?: number
  maxSize?: number
  allInThreadHaveKeyword?: string
  someInThreadHaveKeyword?: string
  noneInThreadHaveKeyword?: string
  hasKeyword?: string
  notKeyword?: string
  hasAttachment?: boolean
  text?: string
  from?: string
  to?: string
  cc?: string
  bcc?: string
  subject?: string
  body?: string
  header?: string[]
}

export interface EmailSort {
  property: 'receivedAt' | 'sentAt' | 'size' | 'from' | 'to' | 'subject'
  isAscending?: boolean
}

// Set Types
export interface EmailSet {
  accountId: string
  ifInState?: string
  create?: Record<string, Partial<Email>>
  update?: Record<string, Partial<Email>>
  destroy?: string[]
}

export interface EmailSetResponse {
  accountId: string
  oldState: string
  newState: string
  created?: Record<string, Email>
  updated?: Record<string, Email | null>
  destroyed?: string[]
  notCreated?: Record<string, SetError>
  notUpdated?: Record<string, SetError>
  notDestroyed?: Record<string, SetError>
}

export interface SetError {
  type: string
  description?: string
  properties?: string[]
}

// Submission Types
export interface EmailSubmission {
  id: string
  emailId: string
  threadId: string
  envelope: Envelope
  sendAt: string
  undoStatus: 'pending' | 'final' | 'canceled'
  deliveryStatus: Record<string, DeliveryStatus>
  dsnBlobIds: string[]
  mdnBlobIds: string[]
}

export interface Envelope {
  mailFrom: EnvelopeAddress
  rcptTo: EnvelopeAddress[]
}

export interface EnvelopeAddress {
  email: string
  parameters?: Record<string, string>
}

export interface DeliveryStatus {
  smtpReply: string
  delivered: 'queued' | 'yes' | 'no' | 'unknown'
  displayed: 'unknown' | 'yes'
}

// Identity Types
export interface Identity {
  id: string
  name: string
  email: string
  replyTo?: EmailAddress[]
  bcc?: EmailAddress[]
  textSignature?: string
  htmlSignature?: string
  mayDelete: boolean
}

// Vacation Response Types
export interface VacationResponse {
  id: string
  isEnabled: boolean
  fromDate?: string
  toDate?: string
  subject?: string
  textBody?: string
  htmlBody?: string
}

// SearchSnippet Types
export interface SearchSnippet {
  emailId: string
  subject?: string
  preview?: string
}

// Changes Types
export interface ChangesRequest {
  accountId: string
  sinceState: string
  maxChanges?: number
}

export interface ChangesResponse<T> {
  accountId: string
  oldState: string
  newState: string
  hasMoreChanges: boolean
  created: string[]
  updated: string[]
  destroyed: string[]
}

// Get Types
export interface GetRequest {
  accountId: string
  ids?: string[] | null
  properties?: string[] | null
}

export interface GetResponse<T> {
  accountId: string
  state: string
  list: T[]
  notFound?: string[]
}

// Copy Types
export interface CopyRequest {
  fromAccountId: string
  accountId: string
  create: Record<string, any>
  onSuccessDestroyOriginal?: boolean
  destroyFromIfInState?: string
}

// Push Types
export interface PushSubscription {
  id: string
  deviceClientId: string
  url: string
  keys?: {
    p256dh: string
    auth: string
  }
  expires?: string
  types?: string[]
}

export interface StateChange {
  changed: Record<string, Record<string, string>>
}

// Method-specific types
export interface MailboxQueryRequest {
  accountId: string
  filter?: MailboxFilter
  sort?: MailboxSort[]
  position?: number
  anchor?: string
  anchorOffset?: number
  limit?: number
  calculateTotal?: boolean
}

export interface MailboxFilter {
  parentId?: string | null
  name?: string
  role?: string
  hasAnyRole?: boolean
  isSubscribed?: boolean
}

export interface MailboxSort {
  property: 'name' | 'sortOrder'
  isAscending?: boolean
}

export interface ThreadGetRequest extends GetRequest {
  fetchEmails?: boolean
  fetchEmailProperties?: string[]
}

// Result Reference Types
export interface ResultReference {
  resultOf: string
  name: string
  path: string
}

// Common Types
export type Id = string
export type UTCDate = string // ISO 8601 format

// Capabilities
export interface CoreCapability {
  maxSizeUpload: number
  maxConcurrentUpload: number
  maxSizeRequest: number
  maxConcurrentRequests: number
  maxCallsInRequest: number
  maxObjectsInGet: number
  maxObjectsInSet: number
  collationAlgorithms: string[]
}

export interface MailCapability {
  maxMailboxesPerEmail?: number
  maxMailboxDepth?: number
  maxSizeAttachmentsPerEmail: number
  emailQuerySortOptions: string[]
  mayCreateTopLevelMailbox: boolean
}

export interface SubmissionCapability {
  maxDelayedSend: number
  submissionExtensions: Record<string, string[]>
}

// Helper types for common patterns
export type FilterOperator<T> = {
  operator: 'AND' | 'OR' | 'NOT'
  conditions: Array<T | FilterOperator<T>>
}

export interface PatchObject {
  [path: string]: any
}

// Error types
export type ErrorType =
  | 'serverUnavailable'
  | 'serverFail'
  | 'serverPartialFail'
  | 'unknownCapability'
  | 'noSuchAccount'
  | 'accountNotFound'
  | 'accountNotSupportedByMethod'
  | 'accountReadOnly'
  | 'requestTooLarge'
  | 'invalidArguments'
  | 'invalidResultReference'
  | 'forbidden'
  | 'cannotCalculateChanges'
  | 'stateMismatch'
