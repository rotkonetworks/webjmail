// src/api/jmap.ts - Fixed EventSource implementation
import { JMAPSession, Email, Mailbox, JMAPRequest, JMAPResponse } from './types'

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
      console.log('[Auth] Raw session response:', responseText)

      try {
        this.session = JSON.parse(responseText)

        if (this.session?.apiUrl?.includes(':8080')) {
          console.log('[Auth] Fixing URLs - removing port and ensuring HTTPS')
          if (this.session.apiUrl) {
            this.session.apiUrl = this.session.apiUrl
              .replace('http://', 'https://')
              .replace(':8080', '')
          }
          if (this.session.downloadUrl) {
            this.session.downloadUrl = this.session.downloadUrl
              .replace('http://', 'https://')
              .replace(':8080', '')
          }
          if (this.session.uploadUrl) {
            this.session.uploadUrl = this.session.uploadUrl
              .replace('http://', 'https://')
              .replace(':8080', '')
          }
          if (this.session.eventSourceUrl) {
            this.session.eventSourceUrl = this.session.eventSourceUrl
              .replace('http://', 'https://')
              .replace(':8080', '')
          }
        } else {
          console.log(
            '[Auth] NOT fixing URLs - protocol:',
            window.location.protocol,
            'apiUrl starts with:',
            this.session?.apiUrl?.substring(0, 8)
          )
        }

        console.log('[Auth] Parsed session:', this.session)

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
    
    console.log('[Auth] Restoring session with stored token')

    try {
      const response = await fetch(authUrl, {
        method: 'GET',
        headers: {
          'Authorization': token,
          'Accept': 'application/json',
        },
        credentials: 'include',
      })

      if (!response.ok) {
        console.error('[Auth] Session restore failed:', response.status)
        throw new Error('Session expired or invalid')
      }

      const responseText = await response.text()
      this.session = JSON.parse(responseText)
      this.accessToken = token
      this.baseUrl = window.location.origin

      console.log('[Auth] Session restored successfully')
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

    console.log('[JMAP] Request details:', {
      apiUrl,
      authHeader: this.accessToken.substring(0, 20) + '...',
      methodCalls: methodCalls.map(([method]) => method),
    })

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

      console.log('[JMAP] Response:', {
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
      console.log('[JMAP] Success response:', {
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

    // Build the EventSource URL properly
    let eventSourceUrl = this.session.eventSourceUrl

    // Replace URL template parameters
    eventSourceUrl = eventSourceUrl
      .replace('{types}', types.join(','))
      .replace('{closeafter}', 'no')
      .replace('{ping}', '30')

    console.log('[EventSource] Original URL template:', this.session.eventSourceUrl)
    console.log('[EventSource] Processed URL:', eventSourceUrl)

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
        console.log('[EventSource] Using proxied EventSource URL:', eventSourceUrl)
      } catch (e) {
        console.error('[EventSource] URL processing error:', e)
      }
    }

    console.log('[EventSource] Final URL:', eventSourceUrl)

    // Create the EventSource
    const eventSource = new EventSource(eventSourceUrl)

    // Add comprehensive logging
    eventSource.addEventListener('open', (event: Event) => {
      console.log('[EventSource] Connection opened successfully')
    })

    eventSource.addEventListener('message', (event) => {
      console.log('[EventSource] Received message:', event.data)
    })

    eventSource.addEventListener('state', (event) => {
      console.log('[EventSource] State change event:', event.data)
      try {
        const data = JSON.parse(event.data)
        console.log('[EventSource] Parsed state data:', data)
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
          console.log('[EventSource] Status: Connecting...')
          break
        case EventSource.OPEN:
          console.log('[EventSource] Status: Connected')
          break
        case EventSource.CLOSED:
          console.log('[EventSource] Status: Connection closed')
          break
      }
    })

    return eventSource
  }

  // Rest of your JMAP methods remain the same...
  async getMailboxes(accountId: string): Promise<Mailbox[]> {
    console.log('[JMAP] Getting mailboxes for account:', accountId)

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
    console.log('[JMAP] Mailboxes retrieved:', result.list?.length || 0)

    return result.list || []
  }

  async getEmails(
    accountId: string,
    filter: any = {},
    properties?: string[],
    position = 0,
    limit = 50
  ): Promise<{ emails: Email[]; total: number; position: number }> {
    console.log('[JMAP] Getting emails:', { accountId, filter, position, limit })

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

  getSession() {
    return this.session
  }
}

export const jmapClient = new JMAPClient()
