import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './stores/authStore'
import { Login } from './pages/Login'
import { Layout } from './components/Layout/Layout'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
})

function AppContent() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isLoading = useAuthStore((state) => state.isLoading)
  const [isInitializing, setIsInitializing] = useState(true)

  useEffect(() => {
    useAuthStore.getState().restoreSession().finally(() => {
      setIsInitializing(false)
    })
  }, [])

  // Show loading screen while checking authentication
  if (isInitializing || isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center">
          <div className="w-16 h-16 bg-[var(--primary-color)] rounded-2xl flex items-center justify-center shadow-lg mb-4 mx-auto">
            <div className="i-lucide:mail text-white text-3xl" />
          </div>
          <div className="i-eos-icons:loading animate-spin text-3xl text-[var(--primary-color)] mb-4" />
          <p className="text-[var(--text-secondary)]">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Login />
  }

  return <Layout />
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  )
}
