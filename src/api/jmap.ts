import { JMAPSession, Email, Mailbox, Thread, JMAPRequest, JMAPResponse } from './types'

export class JMAPClient {
  private session: JMAPSession | null = null
  private accessToken: string = ''
  private baseUrl: string = ''

  async authenticate(serverUrl: string, username: string, password: string) {
    console.log('[JMAP] Starting authentication...', {
      serverUrl,
      username,
      timestamp: new Date().toISOString()
    })

    // For Stalwart, we might need to handle both Basic and Bearer auth
    const token = 'Basic ' + btoa(username + ':' + password)

    try {
      console.log('[JMAP] Sending authentication request...')

      const response = await fetch(serverUrl, {
        method: 'GET',
        headers: {
          'Authorization': token,
          'Accept': 'application/json',
        },
      })

      console.log('[JMAP] Authentication response received:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[JMAP] Authentication failed:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        })

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
      console.log('[JMAP] Raw response:', responseText.substring(0, 500) + '...')

      try {
        this.session = JSON.parse(responseText)
      } catch (parseError) {
        console.error('[JMAP] Failed to parse response as JSON:', parseError)
        throw new Error('Invalid response from server. Expected JSON but got: ' + responseText.substring(0, 100))
      }

      this.accessToken = token
      this.baseUrl = serverUrl.replace('/.well-known/jmap', '')

      // Validate session structure
      if (!this.session.apiUrl) {
        console.error('[JMAP] Invalid session structure:', this.session)
        throw new Error('Invalid session: missing apiUrl')
      }

      // Log session capabilities for debugging
      console.log('[JMAP] Session established successfully:', {
        username: this.session.username,
        accounts: Object.keys(this.session.accounts || {}),
        primaryAccounts: this.session.primaryAccounts,
        capabilities: Object.keys(this.session.capabilities || {}),
        apiUrl: this.session.apiUrl,
        downloadUrl: this.session.downloadUrl,
        uploadUrl: this.session.uploadUrl
      })

      return this.session
    } catch (error) {
      console.error('[JMAP] Authentication error:', error)

      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        console.error('[JMAP] Network error - possible causes:', {
          cors: 'CORS policy blocking request',
          network: 'Server unreachable',
          https: 'SSL/TLS certificate issues'
        })
        throw new Error('Cannot connect to server. Please check:\n- The server URL is correct\n- The server is running\n- CORS is properly configured\n- SSL certificates are valid')
      }
      throw error
    }
  }

  private getProxiedUrl(url: string): string {
    // In development, use the proxy path instead of the full URL
    if (import.meta.env.DEV) {
      try {
        const urlObj = new URL(url)

        // Check if this is a mail.rotko.net URL
        if (urlObj.hostname === 'mail.rotko.net') {
          // Return just the pathname (e.g., /jmap/)
          return urlObj.pathname
        }
      } catch (e) {
        console.error('[JMAP] Failed to parse URL:', url, e)
      }
    }
    return url
  }

  async request(methodCalls: Array<[string, any, string]>) {
    if (!this.session) {
      console.error('[JMAP] No active session')
      throw new Error('Not authenticated')
    }

    const request: JMAPRequest = {
      using: Object.keys(this.session.capabilities),
      methodCalls,
    }

    // Use the proxied URL in development
    const apiUrl = this.getProxiedUrl(this.session.apiUrl)

    console.log('[JMAP] Sending request:', {
      url: apiUrl,
      originalUrl: this.session.apiUrl,
      methods: methodCalls.map(([method]) => method),
      using: request.using
    })

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': this.accessToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(request),
      })

      console.log('[JMAP] Request response:', {
        status: response.status,
        statusText: response.statusText
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[JMAP] Request failed:', {
          status: response.status,
          body: errorText
        })

        if (response.status === 401) {
          // Session expired
          this.session = null
          throw new Error('Session expired. Please login again.')
        }
        throw new Error(`Request failed: ${response.statusText} (${response.status})`)
      }

      const data: JMAPResponse = await response.json()

      console.log('[JMAP] Response data:', {
        methodResponses: data.methodResponses.map(([method, , id]) => ({ method, id })),
        sessionState: data.sessionState
      })

      // Check for method-level errors
      for (const [method, result, id] of data.methodResponses) {
        if (method === 'error') {
          console.error('[JMAP] Method error:', { method, result, id })
          throw new Error(result.description || 'JMAP method error')
        }
      }

      return data.methodResponses
    } catch (error) {
      console.error('[JMAP] Request error:', error)
      throw error
    }
  }

  async getMailboxes(accountId: string): Promise<Mailbox[]> {
    console.log('[JMAP] Fetching mailboxes for account:', accountId)

    const responses = await this.request([
      ['Mailbox/get', { 
        accountId,
        properties: null // Get all properties
      }, '0'],
    ])

    const [, result] = responses[0]
    console.log('[JMAP] Mailboxes fetched:', {
      count: result.list?.length || 0,
      state: result.state
    })

    return result.list || []
  }

  async moveEmail(
    accountId: string,
    emailId: string,
    fromMailboxId: string,
    toMailboxId: string
  ) {
    console.log('[JMAP] Moving email:', { emailId, from: fromMailboxId, to: toMailboxId })

    const update = {
      [emailId]: {
        mailboxIds: {
          [fromMailboxId]: false,
          [toMailboxId]: true,
        }
      }
    }

    return this.setEmail(accountId, update)
  }

  async sendEmail(
    accountId: string,
    email: any,
    submission: any
  ) {
    console.log('[JMAP] Sending email:', { accountId, email })

    const responses = await this.request([
      ['Email/set', { accountId, create: { draft: email } }, '0'],
      ['EmailSubmission/set', { 
        accountId, 
        create: { 
          submission: {
            ...submission,
            emailId: '#draft',
          }
        }
      }, '1'],
    ])

    return responses
  }

  async setEmail(
    accountId: string,
    update: Record<string, Partial<Email>>
  ) {
    console.log('[JMAP] Updating emails:', { accountId, updates: Object.keys(update) })

    const responses = await this.request([
      ['Email/set', { accountId, update }, '0'],
    ])

    const result = responses[0][1]
    console.log('[JMAP] Email update result:', {
      updated: Object.keys(result.updated || {}),
      notUpdated: Object.keys(result.notUpdated || {})
    })

    return result
  }

  getSession() {
    return this.session
  }

  getBlobUrl(accountId: string, blobId: string, type: string, name: string) {
    if (!this.session) throw new Error('Not authenticated')

    // Build the download URL
    let url = this.session.downloadUrl
    .replace('{accountId}', encodeURIComponent(accountId))
    .replace('{blobId}', encodeURIComponent(blobId))
    .replace('{type}', encodeURIComponent(type))
    .replace('{name}', encodeURIComponent(name))

    // Use proxy in development
    url = this.getProxiedUrl(url)

    // Add auth token as query parameter for Stalwart
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}access_token=${encodeURIComponent(this.accessToken)}`
  }

  // EventSource for push notifications (Stalwart supports this)
  createEventSource(types: string[] = ['*']): EventSource {
    if (!this.session) throw new Error('Not authenticated')

    let url = this.session.eventSourceUrl
    .replace('{types}', types.join(','))
    .replace('{closeafter}', 'no')
    .replace('{ping}', '30')

    // Use proxy in development
    url = this.getProxiedUrl(url)

    // Note: EventSource doesn't support custom headers, so auth must be in URL
    const separator = url.includes('?') ? '&' : '?'
    const eventSourceUrl = `${url}${separator}access_token=${encodeURIComponent(this.accessToken)}`

    console.log('[JMAP] Creating EventSource:', eventSourceUrl)

    return new EventSource(eventSourceUrl)
  }

  async searchEmails(
    accountId: string,
    query: string,
    limit = 30
  ): Promise<Email[]> {
    console.log('[JMAP] Searching emails:', { accountId, query, limit })

    const responses = await this.request([
      ['Email/query', { 
        accountId,
        filter: {
          operator: 'OR',
          conditions: [
            { subject: query },
            { from: query },
            { to: query },
            { body: query },
            { text: query }
          ]
        },
        sort: [{ property: 'receivedAt', isAscending: false }],
        limit,
      }, '0'],
      ['Email/get', {
        accountId,
        '#ids': {
          resultOf: '0',
          name: 'Email/query',
          path: '/ids',
        },
        properties: [
          'id', 'blobId', 'threadId', 'mailboxIds', 'keywords',
          'size', 'receivedAt', 'subject', 'from', 'to', 'preview',
          'hasAttachment'
        ],
      }, '1'],
    ])

    const [, getResult] = responses[1]
    return getResult.list || []
  }

  async getEmails(
    accountId: string,
    filter: any = {},
    properties?: string[],
    position = 0,
    limit = 50
  ): Promise<{ emails: Email[]; total: number; position: number }> {
    console.log('[JMAP] Fetching emails:', { accountId, filter, position, limit })

    // Default properties if not specified
    if (!properties) {
      properties = [
        'id', 'blobId', 'threadId', 'mailboxIds', 'keywords',
        'size', 'receivedAt', 'subject', 'from', 'to', 'cc', 'bcc',
        'replyTo', 'sentAt', 'hasAttachment', 'preview', 'bodyStructure',
        'bodyValues', 'textBody', 'htmlBody', 'attachments'
      ]
    }

    const responses = await this.request([
      ['Email/query', { 
        accountId, 
        filter,
        sort: [{ property: 'receivedAt', isAscending: false }],
        position,
        limit,
        calculateTotal: true,
      }, '0'],
      ['Email/get', {
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
        maxBodyValueBytes: 256 * 1024, // 256KB max per body part
      }, '1'],
    ])

    const [, queryResult] = responses[0]
    const [, getResult] = responses[1]

    console.log('[JMAP] Emails fetched:', {
      queryCount: queryResult.ids?.length || 0,
      fetchedCount: getResult.list?.length || 0,
      total: queryResult.total,
      position: queryResult.position,
      state: getResult.state
    })

    return {
      emails: getResult.list || [],
      total: queryResult.total || 0,
      position: queryResult.position || 0
    }
  }

  async getEmailThread(accountId: string, threadId: string): Promise<Email[]> {
    console.log('[JMAP] Fetching thread:', { accountId, threadId })

    const responses = await this.request([
      ['Email/query', { 
        accountId, 
        filter: { inThread: threadId },
        sort: [{ property: 'receivedAt', isAscending: true }], // Oldest first for threads
      }, '0'],
      ['Email/get', {
        accountId,
        '#ids': {
          resultOf: '0',
          name: 'Email/query',
          path: '/ids',
        },
        properties: null, // Get all properties for thread
        fetchTextBodyValues: true,
        fetchHTMLBodyValues: true,
        fetchAllBodyValues: false,
        maxBodyValueBytes: 512 * 1024, // 512KB for thread emails
      }, '1'],
    ])

    const [, getResult] = responses[1]
    return getResult.list || []
  }
}

export const jmapClient = new JMAPClient()
