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

  // Development
  debug: import.meta.env.DEV,
}

// Server presets for quick switching
export const serverPresets = import.meta.env.DEV
  ? [
      {
        name: 'Rotko Mail (Dev Proxy)',
        url: '/.well-known/jmap',
        description: 'Uses Vite proxy to avoid CORS',
      },
      {
        name: 'Rotko Mail (Direct)',
        url: 'https://mail.rotko.net/.well-known/jmap',
        description: 'direct connection (may have CORS issues)',
      },
      {
        name: 'Local Stalwart',
        url: 'http://localhost:8080/.well-known/jmap',
        description: 'local development server',
      },
    ]
  : [
      {
        name: 'Rotko Webmail',
        url: 'https://mail.rotko.net/.well-known/jmap',
        description: 'Stalwart server',
      },
    ]
