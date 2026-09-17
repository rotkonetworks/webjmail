import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './stores/authStore'
import { useUIStore } from './stores/uiStore'
import { Login } from './pages/Login'
import { Layout } from './components/Layout/Layout'
import { Toaster } from './components/Layout/Toaster'
import { Onboarding, hasOnboarded, markOnboarded } from './components/Onboarding/Onboarding'
import { DevConsole } from './components/DevConsole'
import { CommandPalette } from './components/CommandPalette'

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
  const theme = useUIStore((state) => state.theme)
  const font = useUIStore((state) => state.font)
  const [isInitializing, setIsInitializing] = useState(true)
  const [onboarded, setOnboarded] = useState(hasOnboarded)

  // Apply theme/font at the top level so the pre-auth screens (loading, login,
  // onboarding) are themed too — Layout only mounts once authenticated, so
  // without this those screens had no data-theme and relied on the bare :root
  // default (see index.css).
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.setAttribute('data-font', font)
  }, [theme, font])

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
      <CommandPalette />
      <DevConsole />
    </QueryClientProvider>
  )
}
