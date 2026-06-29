import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './stores/authStore'
import { Login } from './pages/Login'
import { Layout } from './components/Layout/Layout'
import { Toaster } from './components/Layout/Toaster'
import { Onboarding, hasOnboarded, markOnboarded } from './components/Onboarding/Onboarding'

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
  const [onboarded, setOnboarded] = useState(hasOnboarded)

  useEffect(() => {
    useAuthStore.getState().restoreSession().finally(() => {
      setIsInitializing(false)
    })
  }, [])

  // An existing user (restored session / manifest auto-login) has implicitly
  // onboarded — don't show the wizard to them.
  useEffect(() => {
    if (isAuthenticated && !onboarded) {
      markOnboarded()
      setOnboarded(true)
    }
  }, [isAuthenticated, onboarded])

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

  if (!isAuthenticated && !onboarded) {
    return <Onboarding onDone={() => setOnboarded(true)} />
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
      <Toaster />
    </QueryClientProvider>
  )
}
