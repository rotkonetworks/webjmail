import React, { useState, useEffect, useCallback } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './stores/authStore'
import { useMailStore } from './stores/mailStore'
import { useUIStore } from './stores/uiStore'
import { Login } from './pages/Login'
import { MailboxList } from './components/Mailbox/MailboxList'
import { MessageList } from './components/Message/MessageList'
import { MessageView } from './components/Message/MessageView'
import { StatusBar } from './components/Layouts/StatusBar'
import { CommandBar } from './components/Layouts/CommandBar'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
})

type ViewMode = 'mailboxes' | 'messages' | 'read' | 'compose'

function AppContent() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const [mode, setMode] = useState<ViewMode>('mailboxes')
  const [commandMode, setCommandMode] = useState(false)
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  
  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Don't handle if in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      
      // Command mode toggle
      if (e.key === ':' && !commandMode) {
        e.preventDefault()
        setCommandMode(true)
        return
      }
      
      if (commandMode) {
        if (e.key === 'Escape') {
          setCommandMode(false)
        }
        return
      }
      
      // Mode switching
      switch (e.key) {
        case 'Escape':
          if (mode === 'read') setMode('messages')
          else if (mode === 'messages') setMode('mailboxes')
          break
        case 'Enter':
          if (mode === 'mailboxes' && selectedMailboxId) setMode('messages')
          else if (mode === 'messages' && selectedEmailId) setMode('read')
          break
        case 'b':
          setMode('mailboxes')
          break
        case 'm':
          if (selectedMailboxId) setMode('messages')
          break
        case 'c':
          setMode('compose')
          break
        case 'q':
          if (e.ctrlKey) {
            useAuthStore.getState().logout()
          }
          break
      }
    }
    
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [mode, commandMode, selectedMailboxId, selectedEmailId])
  
  useEffect(() => {
    useAuthStore.getState().restoreSession()
  }, [])

  if (!isAuthenticated) {
    return <Login />
  }

  return (
    <div className="h-screen flex flex-col bg-black text-white">
      {/* Main content area */}
      <div className="flex-1 overflow-hidden">
        {mode === 'mailboxes' && <MailboxList onSelect={() => setMode('messages')} />}
        {mode === 'messages' && <MessageList onSelect={() => setMode('read')} />}
        {mode === 'read' && <MessageView onClose={() => setMode('messages')} />}
        {mode === 'compose' && <div>Compose (TODO)</div>}
      </div>
      
      {/* Command bar */}
      {commandMode && (
        <CommandBar onClose={() => setCommandMode(false)} />
      )}
      
      {/* Status bar */}
      <StatusBar mode={mode} />
    </div>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  )
}
