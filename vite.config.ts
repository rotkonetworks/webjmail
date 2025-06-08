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
        secure: false,
        rewrite: (path) => path,
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('Proxying:', req.method, req.url, '->', options.target + req.url)
          })
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('Proxy response:', proxyRes.statusCode, req.url)
          })
        }
      },
      // Proxy for JMAP API calls
      '/jmap': {
        target: 'https://mail.rotko.net',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path,
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('Proxying JMAP API:', req.method, req.url)
            // Log headers for debugging
            console.log('Request headers:', proxyReq.getHeaders())
          })
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('JMAP API response:', proxyRes.statusCode, req.url)
          })
        }
      },
      // Proxy for downloads
      '/download': {
        target: 'https://mail.rotko.net',
        changeOrigin: true,
        secure: false,
      },
      // Proxy for uploads
      '/upload': {
        target: 'https://mail.rotko.net',
        changeOrigin: true,
        secure: false,
      },
      // Proxy for event source
      '/eventsource': {
        target: 'https://mail.rotko.net',
        changeOrigin: true,
        secure: false,
        // WebSocket/EventSource support
        ws: true,
      },
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
  },
})
