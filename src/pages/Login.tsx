import React, { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { config, serverPresets } from '../config'

export function Login() {
  const [server, setServer] = useState(config.defaultServer)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState('')

  const { login, isLoading, error: authError, clearError } = useAuthStore()

  useEffect(() => {
    if (authError) {
      setLocalError(authError)
      const timer = setTimeout(() => clearError(), 5000)
      return () => clearTimeout(timer)
    }
  }, [authError, clearError])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')

    if (!server || !username || !password) {
      setLocalError('Please fill in all fields')
      return
    }

    try {
      await login(server, username, password)
    } catch (err) {
      // Error handled by store
    }
  }

  const displayError = localError || authError

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-[var(--primary-color)] rounded-2xl flex items-center justify-center">
            <div className="i-lucide:mail text-white text-3xl" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold text-[var(--text-primary)]">
          {config.appName}
        </h2>
        <p className="mt-2 text-center text-sm text-[var(--text-secondary)]">
          Sign in to your email account
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-[var(--bg-secondary)] py-8 px-4 shadow-xl rounded-lg sm:px-10 border border-[var(--border-color)]">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label
                htmlFor="server"
                className="block text-sm font-medium text-[var(--text-primary)]"
              >
                JMAP Server
              </label>
              <div className="mt-1">
                <input
                  id="server"
                  name="server"
                  type="text"
                  required
                  disabled={isLoading}
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  className="search-input w-full disabled:opacity-50"
                  placeholder="https://mail.example.com/.well-known/jmap"
                />
              </div>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                Using proxy in development mode
              </p>
            </div>

            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-[var(--text-primary)]"
              >
                Username
              </label>
              <div className="mt-1">
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  disabled={isLoading}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="search-input w-full disabled:opacity-50"
                  placeholder="username"
                  autoFocus
                />
              </div>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                Username only, not full email address
              </p>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[var(--text-primary)]"
              >
                Password
              </label>
              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={isLoading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="search-input w-full disabled:opacity-50"
                />
              </div>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                Use app password if 2FA enabled
              </p>
            </div>

            {displayError && (
              <div className="rounded-md bg-red-500/10 border border-red-500/20 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <div className="i-lucide:alert-circle text-red-500" />
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-red-400 whitespace-pre-wrap">{displayError}</p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary w-full flex justify-center items-center py-3 rounded-lg font-medium"
              >
                {isLoading ? (
                  <>
                    <div className="i-eos-icons:loading animate-spin mr-2" />
                    Authenticating...
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[var(--border-color)]" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-[var(--bg-secondary)] text-[var(--text-tertiary)]">
                  Quick select
                </span>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              {serverPresets.map((preset) => (
                <button
                  key={preset.url}
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    setServer(preset.url)
                    setUsername('')
                    setPassword('')
                    setLocalError('')
                  }}
                  className="w-full flex items-center py-3 px-4 border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="i-lucide:server text-[var(--text-secondary)] mr-3" />
                  <div className="text-left flex-1">
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      {preset.name}
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)]">{preset.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {import.meta.env.DEV && (
            <div className="mt-6 p-3 bg-[var(--bg-tertiary)] rounded-lg text-xs text-[var(--text-tertiary)] border border-[var(--border-color)]">
              <p className="font-semibold mb-1 text-[var(--text-secondary)]">Dev Mode:</p>
              <p>• Console: F12 for JMAP logs</p>
              <p>• Network: Monitor requests</p>
              <p>• Proxy: CORS bypassed</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
