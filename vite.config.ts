import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import UnoCSS from 'unocss/vite'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    UnoCSS(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      // Proxy for JMAP discovery
      '/.well-known/jmap': {
        target: 'https://mail.rotko.net',
        changeOrigin: true,
        secure: true,
        headers: {
          'Origin': 'https://mail.rotko.net'
        },
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('[Proxy] JMAP Discovery:', req.method, req.url)
            // Forward auth headers
            if (req.headers.authorization) {
              proxyReq.setHeader('Authorization', req.headers.authorization)
            }
          })
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('[Proxy] Discovery response:', proxyRes.statusCode)
          })
        }
      },
      
      // Proxy for JMAP API calls
      '/jmap': {
        target: 'https://mail.rotko.net',
        changeOrigin: true,
        secure: true,
        headers: {
          'Origin': 'https://mail.rotko.net'
        },
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('[Proxy] JMAP API:', req.method, req.url)
            // Forward auth headers
            if (req.headers.authorization) {
              proxyReq.setHeader('Authorization', req.headers.authorization)
            }
          })
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('[Proxy] API response:', proxyRes.statusCode)
          })
        }
      },

      // Fixed EventSource proxy - this is crucial
      '/eventsource': {
        target: 'https://mail.rotko.net',
        changeOrigin: true,
        secure: true,
        ws: false, // EventSource is HTTP, not WebSocket
        headers: {
          'Origin': 'https://mail.rotko.net',
          'Cache-Control': 'no-cache',
          'Accept': 'text/event-stream'
        },
        pathRewrite: {
          '^/eventsource': '/jmap/eventsource/' // Rewrite to actual server path
        },
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            if (import.meta.env.DEV) {
              console.log('[Proxy] EventSource request URL:', req.url)
              console.log('[Proxy] EventSource method:', req.method)
            }
            
            // Use Authorization header instead of query parameter for security
            if (req.headers.authorization) {
              proxyReq.setHeader('Authorization', req.headers.authorization)
            } else {
              // Extract auth from query parameter only in dev mode (not recommended for prod)
              const url = new URL(req.url, 'http://localhost')
              const authParam = url.searchParams.get('auth')
              
              if (authParam) {
                // Remove auth from query params for security
                url.searchParams.delete('auth')
                
                // Set Authorization header
                proxyReq.setHeader('Authorization', 'Basic ' + authParam)
                
                // Update the request path to match server expectation
                proxyReq.path = '/jmap/eventsource/' + (url.search ? url.search : '')
                
                if (import.meta.env.DEV) {
                  console.log('[Proxy] EventSource auth extracted, new path:', proxyReq.path)
                  // Never log full auth token, even in dev
                  console.log('[Proxy] EventSource auth header set')
                }
              }
            }
            
            // Set proper EventSource headers
            proxyReq.setHeader('Accept', 'text/event-stream')
            proxyReq.setHeader('Cache-Control', 'no-cache')
            proxyReq.setHeader('Connection', 'keep-alive')
            
            if (import.meta.env.DEV) {
              console.log('[Proxy] Final EventSource path:', proxyReq.path)
            }
          })
          
          proxy.on('proxyRes', (proxyRes, req, res) => {
            if (import.meta.env.DEV) {
              console.log('[Proxy] EventSource response status:', proxyRes.statusCode)
              console.log('[Proxy] EventSource response headers:', proxyRes.headers)
            }
            
            // Check if response is actually an EventSource stream
            const contentType = proxyRes.headers['content-type']
            if (proxyRes.statusCode === 200 && contentType && contentType.includes('text/event-stream')) {
              if (import.meta.env.DEV) {
                console.log('[Proxy] Valid EventSource response detected')
              }
            } else {
              if (import.meta.env.DEV) {
                console.error('[Proxy] Invalid EventSource response - Status:', proxyRes.statusCode, 'Content-Type:', contentType)
              }
            }
            
            // Ensure proper EventSource response headers
            if (proxyRes.statusCode === 200) {
              // Don't override server headers, just add missing ones
              if (!proxyRes.headers['content-type'] || !proxyRes.headers['content-type'].includes('text/event-stream')) {
                proxyRes.headers['content-type'] = 'text/event-stream'
              }
              if (!proxyRes.headers['cache-control']) {
                proxyRes.headers['cache-control'] = 'no-cache'
              }
              proxyRes.headers['access-control-allow-origin'] = '*'
              proxyRes.headers['access-control-allow-credentials'] = 'true'
            }
          })
          
          proxy.on('error', (err, req, res) => {
            console.error('[Proxy] EventSource proxy error:', err.message)
            console.error('[Proxy] EventSource proxy error details:', err)
          })
        }
      },
      
      // Proxy for downloads
      '/download': {
        target: 'https://mail.rotko.net',
        changeOrigin: true,
        secure: true,
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            if (req.headers.authorization) {
              proxyReq.setHeader('Authorization', req.headers.authorization)
            }
          })
        }
      },
      
      // Proxy for uploads
      '/upload': {
        target: 'https://mail.rotko.net',
        changeOrigin: true,
        secure: true,
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            if (req.headers.authorization) {
              proxyReq.setHeader('Authorization', req.headers.authorization)
            }
          })
        }
      },
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
  },
})
