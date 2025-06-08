import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useAuthStore } from './stores/authStore'
import { Layout } from './components/Layout/Layout'
import { MessageList } from './components/Message/MessageList'
import { MessageView } from './components/Message/MessageView'
import { Login } from './pages/Login'
import { useUIStore } from './stores/uiStore'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function AppContent() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const messageListWidth = useUIStore((state) => state.messageListWidth)
  
  React.useEffect(() => {
    useAuthStore.getState().restoreSession()
  }, [])

  if (!isAuthenticated) {
    return <Login />
  }

  return (
    <Layout>
      <div 
        className="bg-white border-r border-gray-200 flex flex-col"
        style={{ width: `${messageListWidth}px` }}
      >
        <MessageList />
      </div>
      <div className="flex-1 flex flex-col">
        <MessageView />
      </div>
    </Layout>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
