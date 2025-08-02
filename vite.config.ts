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

      // EventSource proxy - FIXED PATH
      '/jmap/eventsource': {
        target: 'https://mail.rotko.net',
        changeOrigin: true,
        secure: true,
        ws: false, // EventSource is HTTP, not WebSocket
        headers: {
          'Origin': 'https://mail.rotko.net',
          'Accept': 'text/event-stream'
        },
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('[Proxy] EventSource request:', req.url)
            
            // Forward auth headers
            if (req.headers.authorization) {
              proxyReq.setHeader('Authorization', req.headers.authorization)
            }
            
            // Set proper EventSource headers
            proxyReq.setHeader('Accept', 'text/event-stream')
            proxyReq.setHeader('Cache-Control', 'no-cache')
            proxyReq.setHeader('Connection', 'keep-alive')
          })
          
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('[Proxy] EventSource response:', proxyRes.statusCode, proxyRes.headers['content-type'])
            
            // Ensure proper EventSource response headers
            if (proxyRes.statusCode === 200) {
              res.setHeader('Content-Type', 'text/event-stream')
              res.setHeader('Cache-Control', 'no-cache')
              res.setHeader('Connection', 'keep-alive')
              res.setHeader('Access-Control-Allow-Origin', '*')
              res.setHeader('Access-Control-Allow-Credentials', 'true')
            }
          })
          
          proxy.on('error', (err, req, res) => {
            console.error('[Proxy] EventSource error:', err.message)
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
