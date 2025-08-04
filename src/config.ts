// Application configuration
export const config = {
  // Always use proxy path to avoid CORS issues
  defaultServer: '/.well-known/jmap',

  // App branding
  appName: 'Rotko Mail',
  appDescription: 'Modern JMAP email client for Stalwart Mail Server',

  // Feature flags
  features: {
    calendar: false,
    contacts: false,
    search: true,
    compose: true,
    darkMode: false,
  },

  // UI preferences
  ui: {
    defaultTheme: 'light',
    defaultMailboxView: 'messages', // 'messages' or 'conversations'
    messagesPerPage: 50,
    autoMarkAsRead: true,
    autoMarkAsReadDelay: 2000, // ms
  },

  // Security settings
  security: {
    sessionTimeoutMs: 2 * 60 * 60 * 1000, // 2 hours
    maxUserIdLength: 255,
    maxSearchQueryLength: 100,
    maxPreviewLength: 500,
    maxSubjectLength: 1000,
    maxTextInputLength: 10000,
    rateLimitDelayMs: 1000, // Rate limit between requests
  },

  // Performance settings
  performance: {
    emailBatchSize: 50,
    searchResultLimit: 30,
    attachmentPrefetchLimit: 10,
    cacheStaleTimeMs: 60 * 1000, // 1 minute
    refetchIntervalMs: 60 * 1000, // 1 minute
    maxReconnectAttempts: 5,
    reconnectDelayMs: 5000,
    retryMaxDelayMs: 30000,
    searchDebounceMs: 300,
  },

  // Email settings
  email: {
    maxAttachmentSizeMB: 25,
    previewLineLimit: 3,
    threadTimelinePaginationSize: 50,
  },

  // Development
  debug: import.meta.env.DEV,
}

// Server presets for quick switching - always use proxy
export const serverPresets = [
  {
    name: 'Rotko Mail',
    url: '/.well-known/jmap',
    description: 'Connect via webmail.rotko.net proxy',
  },
  {
    name: 'Local Stalwart',
    url: 'http://localhost:8080/.well-known/jmap',
    description: 'Local development server',
  },
]
