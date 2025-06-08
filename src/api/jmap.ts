import { JMAPSession, Email, Mailbox, Thread } from './types'

interface JMAPRequest {
  using: string[]
  methodCalls: Array<[string, any, string]>
  createdIds?: Record<string, string>
}

interface JMAPResponse {
  methodResponses: Array<[string, any, string]>
  createdIds?: Record<string, string>
  sessionState: string
}

export class JMAPClient {
  private session: JMAPSession | null = null
  private accessToken: string = ''

  async authenticate(serverUrl: string, username: string, password: string) {
    const token = 'Basic ' + btoa(username + ':' + password)
    const response = await fetch(serverUrl, {
      headers: {
        'Authorization': token,
        'Accept': 'application/json',
      },
    })
    
    if (!response.ok) {
      throw new Error('Authentication failed')
    }
    
    this.session = await response.json()
    this.accessToken = token
    return this.session
  }

  async request(methodCalls: Array<[string, any, string]>) {
    if (!this.session) {
      throw new Error('Not authenticated')
    }

    const request: JMAPRequest = {
      using: Object.keys(this.session.capabilities),
      methodCalls,
    }

    const response = await fetch(this.session.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': this.accessToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error('Request failed')
    }

    const data: JMAPResponse = await response.json()
    return data.methodResponses
  }

  async getMailboxes(accountId: string): Promise<Mailbox[]> {
    const responses = await this.request([
      ['Mailbox/get', { accountId }, '0'],
    ])
    
    const [, result] = responses[0]
    return result.list
  }

  async getEmails(
    accountId: string,
    filter: any = {},
    properties?: string[]
  ): Promise<Email[]> {
    const responses = await this.request([
      ['Email/query', { accountId, filter }, '0'],
      ['Email/get', {
        accountId,
        '#ids': {
          resultOf: '0',
          name: 'Email/query',
          path: '/ids',
        },
        properties,
      }, '1'],
    ])
    
    const [, result] = responses[1]
    return result.list
  }

  async setEmail(
    accountId: string,
    update: Record<string, Partial<Email>>
  ) {
    const responses = await this.request([
      ['Email/set', { accountId, update }, '0'],
    ])
    
    return responses[0][1]
  }

  getSession() {
    return this.session
  }

  getBlobUrl(accountId: string, blobId: string, type: string, name: string) {
    if (!this.session) throw new Error('Not authenticated')
    
    return this.session.downloadUrl
      .replace('{accountId}', encodeURIComponent(accountId))
      .replace('{blobId}', encodeURIComponent(blobId))
      .replace('{type}', encodeURIComponent(type))
      .replace('{name}', encodeURIComponent(name))
  }
}

export const jmapClient = new JMAPClient()
