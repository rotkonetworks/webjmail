// True when running inside the Tauri desktop shell.
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// Application configuration
export const config = {
  // Default JMAP server. The Vite proxy path only works in a browser dev
  // server; the desktop build talks to the server directly (via Rust), so it
  // always needs a full URL.
  defaultServer:
    import.meta.env.DEV && !IS_TAURI
      ? '/.well-known/jmap' // This will be proxied by Vite
      : import.meta.env.VITE_JMAP_SERVER || 'https://mail.rotko.net/.well-known/jmap',

  // App branding
  appName: 'Webjmail',
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

// URL validation utility
export const validateJMAPServerUrl = (url: string): { isValid: boolean; error?: string; sanitized?: string } => {
  try {
    if (!url || url.trim().length === 0) {
      return { isValid: false, error: 'Server URL is required' }
    }

    const trimmed = url.trim()

    // Add https:// if no protocol specified
    let fullUrl = trimmed
    if (!fullUrl.match(/^https?:\/\//)) {
      fullUrl = 'https://' + fullUrl
    }

    const urlObj = new URL(fullUrl)

    // Security validation
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { isValid: false, error: 'Only HTTP/HTTPS protocols are allowed' }
    }

    if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
      // Allow localhost only in development
      if (!import.meta.env.DEV) {
        return { isValid: false, error: 'Localhost connections only allowed in development' }
      }
    }

    // Ensure path ends with jmap endpoint
    if (!urlObj.pathname.endsWith('/.well-known/jmap') && !urlObj.pathname.endsWith('/jmap')) {
      if (urlObj.pathname === '/' || urlObj.pathname === '') {
        urlObj.pathname = '/.well-known/jmap'
      } else if (!urlObj.pathname.includes('jmap')) {
        return { isValid: false, error: 'URL must end with /.well-known/jmap or contain jmap endpoint' }
      }
    }

    return { isValid: true, sanitized: urlObj.href }
  } catch (error) {
    return { isValid: false, error: 'Invalid URL format' }
  }
}

// Server presets for quick switching
export const serverPresets = [
  {
    name: 'Rotko Networks',
    url: 'https://mail.rotko.net/.well-known/jmap',
    description: 'Rotko Networks JMAP server',
    category: 'recommended',
    features: ['aliases', 'sieve', 'push'],
  },
  {
    name: 'Fastmail',
    url: 'https://jmap.fastmail.com/.well-known/jmap',
    description: 'Fastmail JMAP service',
    category: 'popular',
    features: ['aliases', 'calendar', 'contacts'],
  },
  {
    name: 'Stalwart (Self-hosted)',
    url: 'https://your-domain.com/.well-known/jmap',
    description: 'Self-hosted Stalwart Mail Server',
    category: 'selfhosted',
    features: ['full-control', 'privacy'],
  },
  {
    name: 'Cyrus IMAP (JMAP)',
    url: 'https://your-server.com/.well-known/jmap',
    description: 'Cyrus IMAP server with JMAP support',
    category: 'enterprise',
    features: ['enterprise', 'scalable'],
  },
  {
    name: 'Apache James',
    url: 'https://your-james.com/jmap',
    description: 'Apache James JMAP endpoint',
    category: 'opensource',
    features: ['opensource', 'java'],
  },
]

// Get popular server presets
export const getPopularPresets = () => serverPresets.filter(p => ['recommended', 'popular'].includes(p.category))

// Get all presets by category
export const getPresetsByCategory = () => {
  const categories = {
    recommended: serverPresets.filter(p => p.category === 'recommended'),
    popular: serverPresets.filter(p => p.category === 'popular'),
    selfhosted: serverPresets.filter(p => p.category === 'selfhosted'),
    enterprise: serverPresets.filter(p => p.category === 'enterprise'),
    opensource: serverPresets.filter(p => p.category === 'opensource'),
  }
  return categories
}
