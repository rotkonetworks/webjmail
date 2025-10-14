// Application configuration
export const config = {
  // Default JMAP server - use proxy in development
  defaultServer: import.meta.env.DEV
    ? '/.well-known/jmap' // This will be proxied by Vite
    : import.meta.env.VITE_JMAP_SERVER || 'https://mail.rotko.net/.well-known/jmap',

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

// Server presets for quick switching
export const serverPresets = [
  {
    name: 'Rotko Mail (Direct)',
    url: 'https://mail.rotko.net/.well-known/jmap',
    description: 'Direct connection (may have CORS issues)',
  },
]
