// src/api/jmap.ts - Fixed EventSource implementation
import { JMAPSession, Email, Mailbox, JMAPRequest, JMAPResponse } from './types'
import { isTauri, invoke, Channel } from '../lib/tauri'

// Verbose request/response logging, DEV-only — production must never log auth
// material or full message contents to the console.
const debug = import.meta.env.DEV ? console.log : (..._args: unknown[]) => {}

export class JMAPClient {
  private session: JMAPSession | null = null
  private accessToken: string = ''
  private baseUrl: string = ''

  // Parse a raw JMAP session response, apply the legacy :8080 URL fixups, and
  // store it. Shared by the web and Tauri auth paths.
  private applySession(responseText: string): JMAPSession {
    const session: JMAPSession = JSON.parse(responseText)

    if (session?.apiUrl?.includes(':8080')) {
      const fix = (u?: string) =>
        u ? u.replace('http://', 'https://').replace(':8080', '') : u
      session.apiUrl = fix(session.apiUrl)!
      session.downloadUrl = fix(session.downloadUrl)!
      session.uploadUrl = fix(session.uploadUrl)!
      session.eventSourceUrl = fix(session.eventSourceUrl)!
    }

    if (!session?.apiUrl) {
      throw new Error('Invalid session: missing apiUrl')
    }

    this.session = session
    this.baseUrl = ''
    return session
  }

  // Desktop (Tauri) auth: Rust holds the password + age vault and returns the
  // JMAP session JSON. The browser CORS / proxy dance is bypassed entirely.
  private async authenticateTauri(serverUrl: string, username: string, password: string) {
    const text = await invoke<string>('jmap_login', {
      server: serverUrl,
      username,
      password,
    })
    this.accessToken = ''
    return this.applySession(text)
  }

  // Decrypt stored credentials (if any) and auto-authenticate on launch.
  // Returns the session, or null when no credentials are stored yet.
  async unlock(): Promise<JMAPSession | null> {
    if (!isTauri) return null
    const text = await invoke<string | null>('jmap_unlock')
    if (!text) return null
    this.accessToken = ''
    return this.applySession(text)
  }

  // Configured accounts from the manifest (desktop only). No secrets returned.
  async listAccounts(): Promise<Array<{ name: string; server: string; username: string }>> {
    if (!isTauri) return []
    return invoke('accounts_list')
  }

  // Make `name` the active account: Rust authenticates it and switches the
  // active token; we adopt the returned session for all subsequent requests.
  async switchAccount(name: string): Promise<JMAPSession> {
    const text = await invoke<string>('account_authenticate', { name })
    this.accessToken = ''
    return this.applySession(text)
  }

  // Add an account from the UI. Desktop: Rust persists it to accounts.age (the
  // password never enters JS) and makes it the active session. Browser:
  // authenticate normally — authStore persists it to localStorage.
  async addAccount(
    serverUrl: string,
    username: string,
    password: string,
    name?: string
  ): Promise<JMAPSession> {
    if (isTauri) {
      const text = await invoke<string>('account_add', {
        server: serverUrl,
        username,
        password,
        name: name ?? null,
      })
      this.accessToken = ''
      return this.applySession(text)
    }
    return this.authenticate(serverUrl, username, password)
  }

  // Remove a UI-managed account. Desktop: drop it from accounts.age. Browser:
  // no-op (authStore manages the localStorage account list).
  async removeAccount(name: string): Promise<void> {
    if (isTauri) {
      await invoke('account_remove', { name })
    }
  }

  async authenticate(serverUrl: string, username: string, password: string) {
    if (isTauri) {
      return this.authenticateTauri(serverUrl, username, password)
    }

    // Ensure proper Basic auth format (exactly one space after "Basic")
    const token = 'Basic ' + btoa(username + ':' + password)

    debug('[Auth] Authenticating with:', {
      serverUrl,
      username,
    })

    try {
      const response = await fetch(serverUrl, {
        method: 'GET',
        headers: {
          Authorization: token,
          Accept: 'application/json',
        },
        credentials: 'include',
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[Auth] Failed:', response.status, errorText)

        if (response.status === 401) {
          throw new Error('Invalid username or password')
        }
        if (response.status === 404) {
          throw new Error('JMAP endpoint not found. Please check the server URL.')
        }
        if (response.status === 500) {
          throw new Error('Server error. Please try again later.')
        }
        throw new Error(`Authentication failed: ${response.statusText} (${response.status})`)
      }

      const responseText = await response.text()
      if (import.meta.env.DEV) debug('[Auth] Raw session response:', responseText)

      try {
        this.session = JSON.parse(responseText)

        if (window.location.protocol === 'https:' && this.session?.apiUrl?.startsWith('http://')) {
          const fixUrl = (url: string): string => {
            if (!url) return url

            try {
              const urlObj = new URL(url)
              if (urlObj.protocol === 'http:' && urlObj.hostname === 'mail.rotko.net') {
                urlObj.protocol = 'https:'
                urlObj.port = ''
                return urlObj.toString()
              }
            } catch (e) {
              return url.replace(/^http:/, 'https:').replace(/:\d+\//, '/')
            }
            return url
          }

          if (this.session.apiUrl) {
            const original = this.session.apiUrl
            this.session.apiUrl = fixUrl(this.session.apiUrl)
          }
          if (this.session.downloadUrl) {
            this.session.downloadUrl = fixUrl(this.session.downloadUrl)
          }
          if (this.session.uploadUrl) {
            this.session.uploadUrl = fixUrl(this.session.uploadUrl)
          }
          if (this.session.eventSourceUrl) {
            this.session.eventSourceUrl = fixUrl(this.session.eventSourceUrl)
          }
        } else {
          debug(
            '[Auth] NOT fixing URLs - protocol:',
            window.location.protocol,
            'apiUrl:',
            this.session?.apiUrl?.substring(0, 30)
          )
        }

        debug('[Auth] Parsed session:', this.session)

        // Store auth token for future requests
        this.accessToken = token
        this.baseUrl = serverUrl.replace('/.well-known/jmap', '')

        // Validate session structure
        if (!this.session?.apiUrl) {
          throw new Error('Invalid session: missing apiUrl')
        }

        return this.session
      } catch (parseError) {
        console.error('[Auth] Parse error:', parseError)
        console.error('[Auth] Response that failed to parse:', responseText)
        throw new Error('Invalid response from server. Expected JSON.')
      }
    } catch (error) {
      console.error('[Auth] Error:', error)
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        throw new Error(
          'Cannot connect to server. Please check:\n- The server URL is correct\n- The server is running\n- CORS is properly configured\n- SSL certificates are valid'
        )
      }
      throw error
    }
  }

  async restoreSession(serverUrl: string, token: string) {
    // Restore session using stored token
    const authUrl = import.meta.env.PROD && serverUrl.includes('mail.rotko.net')
      ? '/.well-known/jmap'
      : serverUrl

    debug('[Auth] Restoring session with stored token')

    try {
      const response = await fetch(authUrl, {
        method: 'GET',
        headers: {
          Authorization: token,
          Accept: 'application/json',
        },
        credentials: 'include',
      })

      if (!response.ok) {
        console.error('[Auth] Session restore failed:', response.status)
        throw new Error('Session expired or invalid')
      }

      const responseText = await response.text()
      this.session = JSON.parse(responseText)

      if (window.location.protocol === 'https:' && this.session?.apiUrl?.startsWith('http://')) {
        console.log('[Auth] Fixing restored session URLs')

        const fixUrl = (url: string): string => {
          if (!url) return url
          try {
            const urlObj = new URL(url)
            if (urlObj.protocol === 'http:' && urlObj.hostname === 'mail.rotko.net') {
              urlObj.protocol = 'https:'
              urlObj.port = ''
              return urlObj.toString()
            }
          } catch (e) {
            return url.replace(/^http:/, 'https:').replace(/:\d+\//, '/')
          }
          return url
        }

        if (this.session.apiUrl) {
          this.session.apiUrl = fixUrl(this.session.apiUrl)
        }
        if (this.session.downloadUrl) {
          this.session.downloadUrl = fixUrl(this.session.downloadUrl)
        }
        if (this.session.uploadUrl) {
          this.session.uploadUrl = fixUrl(this.session.uploadUrl)
        }
        if (this.session.eventSourceUrl) {
          this.session.eventSourceUrl = fixUrl(this.session.eventSourceUrl)
        }
      }

      this.accessToken = token
      this.baseUrl = window.location.origin

      debug('[Auth] Session restored successfully')
      return this.session
    } catch (error) {
      console.error('[Auth] Failed to restore session:', error)
      throw error
    }
  }

  clearSession() {
    this.session = null
    this.accessToken = ''
    this.baseUrl = ''
  }

  // End the session. In the desktop build this also clears the Rust-side token;
  // the age vault is kept, so the next launch logs back in automatically.
  async logout() {
    if (isTauri) {
      try {
        await invoke('jmap_logout')
      } catch (e) {
        console.error('[JMAP] logout failed:', e)
      }
    }
    this.clearSession()
  }

  private getProxiedUrl(url: string): string {
    // Desktop build talks to the server directly through Rust — no proxy path.
    if (isTauri) return url
    // In development, use the proxy path instead of the full URL
    if (import.meta.env.DEV) {
      try {
        const urlObj = new URL(url, this.baseUrl || window.location.origin)
        debug('[JMAP] Original URL:', url)
        debug('[JMAP] Parsed URL:', urlObj.href)

        // Check if this is a mail.rotko.net URL
        if (urlObj.hostname === 'mail.rotko.net' || urlObj.hostname === 'localhost') {
          // Return just the pathname (e.g., /jmap/)
          debug('[JMAP] Using proxied path:', urlObj.pathname)
          return urlObj.pathname
        }
      } catch (e) {
        console.error('[JMAP] URL parsing error:', e)
      }
    }
    return url
  }

  async request(methodCalls: Array<[string, any, string]>) {
    if (!this.session) {
      throw new Error('Not authenticated')
    }

    const request: JMAPRequest = {
      using: Object.keys(this.session.capabilities),
      methodCalls,
    }

    // Desktop: proxy through Rust (no CORS, auth attached server-side).
    if (isTauri) {
      const text = await invoke<string>('jmap_request', {
        apiUrl: this.session.apiUrl,
        body: JSON.stringify(request),
      })
      const data: JMAPResponse = JSON.parse(text)
      for (const [method, result] of data.methodResponses) {
        if (method === 'error') {
          throw new Error(result.description || 'JMAP method error')
        }
      }
      return data.methodResponses
    }

    const apiUrl = this.getProxiedUrl(this.session.apiUrl)

    if (import.meta.env.DEV) {
      debug('[JMAP] Request details:', {
        apiUrl,
        methodCalls: methodCalls.map(([method]) => method),
      })
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: this.accessToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(request),
      })

      debug('[JMAP] Response:', {
        status: response.status,
        statusText: response.statusText,
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[JMAP] Error response body:', errorText)

        if (response.status === 401) {
          this.session = null
          throw new Error('Authentication failed. Please login again.')
        }

        throw new Error(`Request failed: ${response.statusText} (${response.status})`)
      }

      const data: JMAPResponse = await response.json()
      debug('[JMAP] Success response:', {
        methodResponses: data.methodResponses.map(([method, , id]) => `${method}[${id}]`),
        sessionState: data.sessionState,
      })

      // Check for method-level errors
      for (const [method, result, _id] of data.methodResponses) {
        if (method === 'error') {
          console.error('[JMAP] Method error:', result)
          throw new Error(result.description || 'JMAP method error')
        }
      }

      return data.methodResponses
    } catch (error) {
      console.error('[JMAP] Request failed:', error)
      throw error
    }
  }

  // Fixed EventSource implementation with authentication workaround
  createEventSource(types: string[] = ['*']): EventSource {
    if (!this.session) throw new Error('Not authenticated')
    // EventSource can't be proxied through Rust the same way; the desktop build
    // relies on polling instead (see SyncEngine.startPushSync).
    if (isTauri) throw new Error('EventSource is not supported in the desktop build')

    // Build the EventSource URL properly
    let eventSourceUrl = this.session.eventSourceUrl

    // Replace URL template parameters
    eventSourceUrl = eventSourceUrl
      .replace('{types}', types.join(','))
      .replace('{closeafter}', 'no')
      .replace('{ping}', '30')

    debug('[EventSource] Original URL template:', this.session.eventSourceUrl)
    debug('[EventSource] Processed URL:', eventSourceUrl)

    // Handle proxy in development
    if (import.meta.env.DEV) {
      try {
        const urlObj = new URL(eventSourceUrl, this.baseUrl || window.location.origin)

        // For EventSource in dev, we need to pass auth as a query parameter
        // because EventSource doesn't support custom headers
        const authToken = this.accessToken.replace('Basic ', '')
        urlObj.searchParams.set('authorization', authToken)

        // Use the proxied path with query parameters
        eventSourceUrl = urlObj.pathname + urlObj.search
        debug('[EventSource] Using proxied EventSource URL:', eventSourceUrl)
      } catch (e) {
        console.error('[EventSource] URL processing error:', e)
      }
    }

    debug('[EventSource] Final URL:', eventSourceUrl)

    // Create the EventSource
    const eventSource = new EventSource(eventSourceUrl)

    // Add comprehensive logging
    eventSource.addEventListener('open', (event: Event) => {
      debug('[EventSource] Connection opened successfully')
    })

    eventSource.addEventListener('message', (event) => {
      debug('[EventSource] Received message:', event.data)
    })

    eventSource.addEventListener('state', (event) => {
      debug('[EventSource] State change event:', event.data)
      try {
        const data = JSON.parse(event.data)
        debug('[EventSource] Parsed state data:', data)
      } catch (e) {
        console.error('[EventSource] Failed to parse state data:', e)
      }
    })

    eventSource.addEventListener('error', (event) => {
      console.error('[EventSource] Connection error:', event)
      console.error('[EventSource] ReadyState:', eventSource.readyState)

      // ReadyState values: 0=CONNECTING, 1=OPEN, 2=CLOSED
      switch (eventSource.readyState) {
        case EventSource.CONNECTING:
          debug('[EventSource] Status: Connecting...')
          break
        case EventSource.OPEN:
          debug('[EventSource] Status: Connected')
          break
        case EventSource.CLOSED:
          debug('[EventSource] Status: Connection closed')
          break
      }
    })

    return eventSource
  }

  // Rest of your JMAP methods remain the same...
  async getMailboxes(accountId: string): Promise<Mailbox[]> {
    debug('[JMAP] Getting mailboxes for account:', accountId)

    const responses = await this.request([
      [
        'Mailbox/get',
        {
          accountId,
          properties: null,
        },
        '0',
      ],
    ])

    const [, result] = responses[0]
    debug('[JMAP] Mailboxes retrieved:', result.list?.length || 0)

    return result.list || []
  }

  async getEmails(
    accountId: string,
    filter: any = {},
    properties?: string[],
    position = 0,
    limit = 50
  ): Promise<{ emails: Email[]; total: number; position: number }> {
    debug('[JMAP] Getting emails:', { accountId, filter, position, limit })

    if (!properties) {
      properties = [
        'id',
        'blobId',
        'threadId',
        'mailboxIds',
        'keywords',
        'size',
        'receivedAt',
        'subject',
        'from',
        'to',
        'cc',
        'bcc',
        'replyTo',
        'sentAt',
        'hasAttachment',
        'preview',
        'bodyStructure',
        'bodyValues',
        'textBody',
        'htmlBody',
        'attachments',
      ]
    }

    const responses = await this.request([
      [
        'Email/query',
        {
          accountId,
          filter,
          sort: [{ property: 'receivedAt', isAscending: false }],
          position,
          limit,
          calculateTotal: true,
        },
        '0',
      ],
      [
        'Email/get',
        {
          accountId,
          '#ids': {
            resultOf: '0',
            name: 'Email/query',
            path: '/ids',
          },
          properties,
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true,
          fetchAllBodyValues: false,
          maxBodyValueBytes: 256 * 1024,
        },
        '1',
      ],
    ])

    const [, queryResult] = responses[0]
    const [, getResult] = responses[1]

    debug('[JMAP] Emails retrieved:', {
      count: getResult.list?.length || 0,
      total: queryResult.total || 0,
      position: queryResult.position || 0,
    })

    return {
      emails: getResult.list || [],
      total: queryResult.total || 0,
      position: queryResult.position || 0,
    }
  }

  // --- Unified inbox (desktop, multi-account) -----------------------------
  // Per-account JMAP sessions, memoized for the app run (stable; avoids
  // re-hitting account_session on every unified refresh / bulk action).
  private accountSessions = new Map<string, JMAPSession>()

  // Fetch one account's JMAP session WITHOUT changing the active account.
  async getAccountSession(name: string): Promise<JMAPSession> {
    if (!isTauri) throw new Error('Unified inbox is only available in the desktop app')
    const cached = this.accountSessions.get(name)
    if (cached) return cached
    const text = await invoke<string>('account_session', { name })
    const session = JSON.parse(text) as JMAPSession
    this.accountSessions.set(name, session)
    return session
  }

  // Run a JMAP request against a SPECIFIC account (by name), using that account's
  // session/apiUrl + token — independent of the active account.
  private async requestAs(
    session: JMAPSession,
    accountName: string,
    methodCalls: Array<[string, any, string]>
  ) {
    if (!isTauri) throw new Error('Unified inbox is only available in the desktop app')
    const body = JSON.stringify({ using: Object.keys(session.capabilities), methodCalls })
    const text = await invoke<string>('jmap_request', {
      apiUrl: session.apiUrl,
      body,
      account: accountName,
    })
    const data: JMAPResponse = JSON.parse(text)
    for (const [method, result] of data.methodResponses) {
      if (method === 'error') throw new Error(result.description || 'JMAP method error')
    }
    return data.methodResponses
  }

  // Newest inbox emails + unread count for one account (the merged unified view).
  // Two requests: locate the inbox mailbox by role, then get its unread count +
  // query/get its emails (a back-reference into a filter isn't valid JMAP, so
  // the id is resolved first).
  async getAccountInbox(
    session: JMAPSession,
    accountName: string,
    limit = 50
  ): Promise<{ emails: Email[]; inboxId: string | null; unread: number }> {
    const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:mail']
    if (!accountId) return { emails: [], inboxId: null, unread: 0 }

    const mbResp = await this.requestAs(session, accountName, [
      ['Mailbox/query', { accountId, filter: { role: 'inbox' } }, 'm'],
    ])
    const inboxId = mbResp.find(([m]) => m === 'Mailbox/query')?.[1]?.ids?.[0] ?? null
    if (!inboxId) return { emails: [], inboxId: null, unread: 0 }

    const responses = await this.requestAs(session, accountName, [
      ['Mailbox/get', { accountId, ids: [inboxId], properties: ['unreadEmails'] }, 'mb'],
      [
        'Email/query',
        {
          accountId,
          filter: { inMailbox: inboxId },
          sort: [{ property: 'receivedAt', isAscending: false }],
          limit,
          calculateTotal: false,
        },
        'q',
      ],
      [
        'Email/get',
        {
          accountId,
          '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' },
          properties: [
            'id', 'blobId', 'threadId', 'mailboxIds', 'keywords', 'receivedAt',
            'subject', 'from', 'to', 'preview', 'hasAttachment',
          ],
        },
        'g',
      ],
    ])
    const unread =
      (responses.find(([m]) => m === 'Mailbox/get')?.[1]?.list?.[0]?.unreadEmails as number) ?? 0
    const getResult = responses.find(([m]) => m === 'Email/get')?.[1]
    return { emails: (getResult?.list || []) as Email[], inboxId, unread }
  }

  // Per-account bulk ops for the unified multi-select (grouped by account upstream).
  async setEmailAs(accountName: string, update: Record<string, any>): Promise<void> {
    const session = await this.getAccountSession(accountName)
    const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:mail']
    if (!accountId) return
    await this.requestAs(session, accountName, [['Email/set', { accountId, update }, '0']])
  }

  async destroyEmailsAs(accountName: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const session = await this.getAccountSession(accountName)
    const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:mail']
    if (!accountId) return
    await this.requestAs(session, accountName, [['Email/set', { accountId, destroy: ids }, '0']])
  }

  async searchEmails(accountId: string, query: string, limit = 30): Promise<Email[]> {
    const responses = await this.request([
      [
        'Email/query',
        {
          accountId,
          filter: {
            operator: 'OR',
            conditions: [
              { subject: query },
              { from: query },
              { to: query },
              { body: query },
              { text: query },
            ],
          },
          sort: [{ property: 'receivedAt', isAscending: false }],
          limit,
        },
        '0',
      ],
      [
        'Email/get',
        {
          accountId,
          '#ids': {
            resultOf: '0',
            name: 'Email/query',
            path: '/ids',
          },
          properties: [
            'id',
            'blobId',
            'threadId',
            'mailboxIds',
            'keywords',
            'size',
            'receivedAt',
            'subject',
            'from',
            'to',
            'preview',
            'hasAttachment',
          ],
        },
        '1',
      ],
    ])

    const [, getResult] = responses[1]
    return getResult.list || []
  }

  async getEmailThread(accountId: string, threadId: string): Promise<Email[]> {
    const responses = await this.request([
      [
        'Email/query',
        {
          accountId,
          filter: { inThread: threadId },
          sort: [{ property: 'receivedAt', isAscending: true }],
        },
        '0',
      ],
      [
        'Email/get',
        {
          accountId,
          '#ids': {
            resultOf: '0',
            name: 'Email/query',
            path: '/ids',
          },
          properties: null,
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true,
          fetchAllBodyValues: false,
          maxBodyValueBytes: 512 * 1024,
        },
        '1',
      ],
    ])

    const [, getResult] = responses[1]
    return getResult.list || []
  }

  async createMailbox(accountId: string, name: string, parentId: string | null = null) {
    const responses = await this.request([
      ['Mailbox/set', { accountId, create: { newMailbox: { name, parentId } } }, '0'],
    ])
    const [, result] = responses[0]
    if (result.notCreated?.newMailbox) {
      const err = result.notCreated.newMailbox
      throw new Error(err.description || `Failed to create folder: ${err.type}`)
    }
    return result.created?.newMailbox
  }

  async updateMailbox(
    accountId: string,
    id: string,
    updates: { name?: string; parentId?: string | null }
  ) {
    const responses = await this.request([
      ['Mailbox/set', { accountId, update: { [id]: updates } }, '0'],
    ])
    const [, result] = responses[0]
    if (result.notUpdated?.[id]) {
      throw new Error(result.notUpdated[id].description || 'Failed to update folder')
    }
    return result.updated?.[id]
  }

  async destroyMailbox(accountId: string, id: string) {
    const responses = await this.request([
      ['Mailbox/set', { accountId, destroy: [id] }, '0'],
    ])
    const [, result] = responses[0]
    if (result.notDestroyed?.[id]) {
      throw new Error(result.notDestroyed[id].description || 'Failed to delete folder')
    }
    return true
  }

  // Mark every unread email in a mailbox as read. Returns how many were updated.
  async markMailboxRead(accountId: string, mailboxId: string): Promise<number> {
    const queryRes = await this.request([
      [
        'Email/query',
        { accountId, filter: { inMailbox: mailboxId, notKeyword: '$seen' }, limit: 1000 },
        '0',
      ],
    ])
    const ids: string[] = queryRes[0][1].ids || []
    if (ids.length === 0) return 0
    const update: Record<string, any> = {}
    for (const id of ids) update[id] = { 'keywords/$seen': true }
    await this.request([['Email/set', { accountId, update }, '1']])
    return ids.length
  }

  async setEmail(accountId: string, update: Record<string, Partial<Email>>) {
    const responses = await this.request([['Email/set', { accountId, update }, '0']])
    return responses[0][1]
  }

  getBlobUrl(accountId: string, blobId: string, type: string, name: string) {
    if (!this.session) throw new Error('Not authenticated')

    let url = this.session.downloadUrl
      .replace('{accountId}', encodeURIComponent(accountId))
      .replace('{blobId}', encodeURIComponent(blobId))
      .replace('{type}', encodeURIComponent(type))
      .replace('{name}', encodeURIComponent(name))

    url = this.getProxiedUrl(url)
    return url
  }

  // Desktop: download a blob through Rust (attaches auth) and save it to the
  // OS Downloads folder. Returns the saved path. Web returns null (caller uses
  // the plain <a download> fallback).
  async downloadBlob(url: string, filename: string): Promise<string | null> {
    if (!isTauri) return null
    return invoke<string>('jmap_download_save', { url, filename })
  }

  // Upload a file as a JMAP blob (for attachments). Desktop routes the bytes
  // through Rust (CORS + auth); web POSTs directly via the proxy.
  async uploadBlob(
    accountId: string,
    file: File
  ): Promise<{ blobId: string; type: string; size: number; name: string }> {
    if (!this.session) throw new Error('Not authenticated')
    const uploadUrl = this.session.uploadUrl.replace('{accountId}', encodeURIComponent(accountId))
    const contentType = file.type || 'application/octet-stream'

    let res: { blobId: string; type?: string; size?: number }
    if (isTauri) {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1] || '')
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      const text = await invoke<string>('jmap_upload', { uploadUrl, contentType, dataBase64 })
      res = JSON.parse(text)
    } else {
      const resp = await fetch(this.getProxiedUrl(uploadUrl), {
        method: 'POST',
        headers: { Authorization: this.accessToken, 'Content-Type': contentType },
        credentials: 'include',
        body: file,
      })
      if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`)
      res = await resp.json()
    }
    return {
      blobId: res.blobId,
      type: res.type || contentType,
      size: res.size ?? file.size,
      name: file.name,
    }
  }

  // --- Claude subscription agent (desktop only) ---
  // `source`: 'app' = webjmail's own login, 'claude-code' = reused Claude Code
  // login (read-only), null = signed out.
  async claudeAuthStatus(): Promise<{
    loggedIn: boolean
    subscriptionType: string | null
    expired: boolean
    source: 'app' | 'claude-code' | null
  }> {
    if (!isTauri) return { loggedIn: false, subscriptionType: null, expired: false, source: null }
    return invoke('claude_auth_status')
  }

  // Proxy a Messages API call through Rust (subscription token attached there).
  async claudeMessage(body: unknown): Promise<any> {
    if (!isTauri) throw new Error('The assistant is only available in the desktop app')
    const text = await invoke<string>('claude_message', { body: JSON.stringify(body) })
    return JSON.parse(text)
  }

  // Streaming Messages API call. Rust relays raw SSE chunks over a Channel; the
  // caller parses them. Resolves when the stream ends.
  async claudeMessageStream(body: unknown, onChunk: (chunk: string) => void): Promise<void> {
    if (!isTauri) throw new Error('The assistant is only available in the desktop app')
    const channel = new Channel<string>()
    channel.onmessage = onChunk
    await invoke('claude_message_stream', { body: JSON.stringify(body), onChunk: channel })
  }

  // Begin the Claude subscription OAuth flow (PKCE). Returns the authorize URL
  // to open in the browser plus the PKCE verifier to pass back to finish.
  async claudeLoginStart(): Promise<{ url: string; verifier: string }> {
    if (!isTauri) throw new Error('Claude sign-in is only available in the desktop app')
    return invoke('claude_login_start')
  }

  // Complete sign-in with the pasted code (`code#state`) + the verifier.
  async claudeLoginFinish(
    code: string,
    verifier: string
  ): Promise<{
    loggedIn: boolean
    subscriptionType: string | null
    expired: boolean
    source: 'app' | 'claude-code' | null
  }> {
    if (!isTauri) throw new Error('Claude sign-in is only available in the desktop app')
    return invoke('claude_login_finish', { code, verifier })
  }

  // Sign out of the Claude subscription (clears ~/.claude/.credentials.json,
  // which is shared with the Claude Code CLI).
  async claudeLogout(): Promise<void> {
    if (!isTauri) return
    await invoke('claude_logout')
  }

  // Fetch a single email with its body (for the assistant to read).
  async getEmailById(accountId: string, id: string): Promise<Email | null> {
    const responses = await this.request([
      [
        'Email/get',
        {
          accountId,
          ids: [id],
          properties: ['id', 'threadId', 'subject', 'from', 'to', 'cc', 'receivedAt', 'preview', 'textBody', 'htmlBody', 'bodyValues'],
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true,
          maxBodyValueBytes: 256 * 1024,
        },
        '0',
      ],
    ])
    const [, result] = responses[0]
    return result.list?.[0] || null
  }

  // Open a URL or file path externally (browser / default app). Desktop routes
  // through Rust; web opens a new tab.
  async openExternal(target: string): Promise<void> {
    if (isTauri) {
      await invoke('open_external', { target })
    } else if (typeof window !== 'undefined') {
      window.open(target, '_blank', 'noopener,noreferrer')
    }
  }

  getSession() {
    return this.session
  }
}

export const jmapClient = new JMAPClient()
