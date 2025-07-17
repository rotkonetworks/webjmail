import { JMAPSession, Email, Mailbox, Thread, JMAPRequest, JMAPResponse } from './types'

export class JMAPClient {
  private session: JMAPSession | null = null
  private accessToken: string = ''
  private baseUrl: string = ''

  async authenticate(serverUrl: string, username: string, password: string) {
    // Ensure proper Basic auth format (exactly one space after "Basic")
    const token = 'Basic ' + btoa(username + ':' + password)
    
    console.log('[Auth] Authenticating with:', {
      serverUrl,
      username,
      tokenFormat: token.substring(0, 10) + '...',
    })

    try {
      const response = await fetch(serverUrl, {
        method: 'GET',
        headers: {
          'Authorization': token,
          'Accept': 'application/json',
        },
        credentials: 'include', // Include cookies if any
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
      console.log('[Auth] Raw session response:', responseText)

      try {
        this.session = JSON.parse(responseText)
        console.log('[Auth] Parsed session:', this.session)
        
        // Check if the session contains any special auth token
        if ((this.session as any).accessToken) {
          console.log('[Auth] Found accessToken in session')
          this.accessToken = `Bearer ${(this.session as any).accessToken}`
        } else if ((this.session as any).token) {
          console.log('[Auth] Found token in session')
          this.accessToken = `Bearer ${(this.session as any).token}`
        } else {
          // Continue using Basic auth
          console.log('[Auth] No special token found, continuing with Basic auth')
          this.accessToken = token
        }
        
        console.log('[Auth] Using auth header:', this.accessToken.substring(0, 20) + '...')
        console.log('[Auth] Session apiUrl:', this.session.apiUrl)
        
        this.baseUrl = serverUrl.replace('/.well-known/jmap', '')

        // Validate session structure
        if (!this.session.apiUrl) {
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

  private getProxiedUrl(url: string): string {
    // In development, use the proxy path instead of the full URL
    if (import.meta.env.DEV) {
      try {
        const urlObj = new URL(url, this.baseUrl || window.location.origin)
        console.log('[JMAP] Original URL:', url)
        console.log('[JMAP] Parsed URL:', urlObj.href)
        
        // Check if this is a mail.rotko.net URL
        if (urlObj.hostname === 'mail.rotko.net' || urlObj.hostname === 'localhost') {
          // Return just the pathname (e.g., /jmap/)
          console.log('[JMAP] Using proxied path:', urlObj.pathname)
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

    const apiUrl = this.getProxiedUrl(this.session.apiUrl)

    // Debug logging
    console.log('[JMAP] Request details:', {
      apiUrl,
      fullUrl: new URL(apiUrl, window.location.origin).href,
      authHeader: this.accessToken,
      authHeaderLength: this.accessToken.length,
      sessionApiUrl: this.session.apiUrl,
      methodCalls: methodCalls.map(([method]) => method),
    })

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': this.accessToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        credentials: 'include', // Include cookies if any
        body: JSON.stringify(request),
      })

      console.log('[JMAP] Response:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[JMAP] Error response body:', errorText)

        if (response.status === 401) {
          // Try to parse the error for more details
          try {
            const errorJson = JSON.parse(errorText)
            console.error('[JMAP] Parsed error:', errorJson)
          } catch (e) {
            // Not JSON, that's ok
          }
          
          // Session expired or invalid
          this.session = null
          throw new Error('Authentication failed. Please login again.')
        }
        
        throw new Error(`Request failed: ${response.statusText} (${response.status})`)
      }

      const data: JMAPResponse = await response.json()
      console.log('[JMAP] Success response:', {
        methodResponses: data.methodResponses.map(([method, , id]) => `${method}[${id}]`),
        sessionState: data.sessionState,
      })

      // Check for method-level errors
      for (const [method, result, id] of data.methodResponses) {
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

  async getMailboxes(accountId: string): Promise<Mailbox[]> {
    console.log('[JMAP] Getting mailboxes for account:', accountId)
    
    const responses = await this.request([
      [
        'Mailbox/get',
        {
          accountId,
          properties: null, // Get all properties
        },
        '0',
      ],
    ])

    const [, result] = responses[0]
    console.log('[JMAP] Mailboxes retrieved:', result.list?.length || 0)

    return result.list || []
  }

  async moveEmail(accountId: string, emailId: string, fromMailboxId: string, toMailboxId: string) {
    const update = {
      [emailId]: {
        mailboxIds: {
          [fromMailboxId]: false,
          [toMailboxId]: true,
        },
      },
    }

    return this.setEmail(accountId, update)
  }

  async sendEmail(accountId: string, email: any, submission: any) {
    const responses = await this.request([
      ['Email/set', { accountId, create: { draft: email } }, '0'],
      [
        'EmailSubmission/set',
        {
          accountId,
          create: {
            submission: {
              ...submission,
              emailId: '#draft',
            },
          },
        },
        '1',
      ],
    ])

    return responses
  }

  async setEmail(accountId: string, update: Record<string, Partial<Email>>) {
    const responses = await this.request([['Email/set', { accountId, update }, '0']])

    const result = responses[0][1]

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

    // Return URL without token - auth should be handled via headers
    return url
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

    // For EventSource, we need to append auth token as query parameter
    // since EventSource doesn't support custom headers
    const authToken = this.accessToken.replace('Basic ', '')
    const encodedToken = encodeURIComponent(authToken)
    
    // Check if URL already has query parameters
    const separator = url.includes('?') ? '&' : '?'
    url = `${url}${separator}authorization=Basic%20${encodedToken}`

    console.log('[EventSource] Creating connection to:', url.split('?')[0])

    const eventSource = new EventSource(url)

    // Add logging for debugging
    eventSource.addEventListener('open', () => {
      console.log('[EventSource] Connection opened')
    })

    eventSource.addEventListener('error', (event) => {
      console.error('[EventSource] Connection error:', event)
    })

    return eventSource
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

  async getEmails(
    accountId: string,
    filter: any = {},
    properties?: string[],
    position = 0,
    limit = 50
  ): Promise<{ emails: Email[]; total: number; position: number }> {
    console.log('[JMAP] Getting emails:', { accountId, filter, position, limit })

    // Default properties if not specified
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
          maxBodyValueBytes: 256 * 1024, // 256KB max per body part
        },
        '1',
      ],
    ])

    const [, queryResult] = responses[0]
    const [, getResult] = responses[1]

    console.log('[JMAP] Emails retrieved:', {
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

  async getEmailThread(accountId: string, threadId: string): Promise<Email[]> {
    const responses = await this.request([
      [
        'Email/query',
        {
          accountId,
          filter: { inThread: threadId },
          sort: [{ property: 'receivedAt', isAscending: true }], // Oldest first for threads
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
          properties: null, // Get all properties for thread
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true,
          fetchAllBodyValues: false,
          maxBodyValueBytes: 512 * 1024, // 512KB for thread emails
        },
        '1',
      ],
    ])

    const [, getResult] = responses[1]
    return getResult.list || []
  }
}

export const jmapClient = new JMAPClient()
