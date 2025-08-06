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

  const handlePresetSelect = (preset: typeof serverPresets[0]) => {
    setServer(preset.url)
    setUsername('')
    setPassword('')
    setLocalError('')
  }

  const displayError = localError || authError

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
            <div className="i-lucide:mail text-white text-3xl" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold text-gray-900 dark:text-white">
          {config.appName}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
          Sign in to your email account
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-gray-800 py-8 px-4 shadow-xl rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit} autoComplete="on" noValidate>
            <div>
              <label
                htmlFor="server"
                className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
              >
                JMAP Server
              </label>
              <input
                id="server"
                name="server"
                type="text"
                required
                disabled={isLoading}
                value={server}
                onChange={(e) => setServer(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="/.well-known/jmap"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Using proxy in development mode
              </p>
            </div>

            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                required
                disabled={isLoading}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="username"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Username only, not full email address
              </p>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={isLoading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="••••••••"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Use app password if 2FA enabled
              </p>
            </div>

            {displayError && (
              <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <div className="i-lucide:alert-circle text-red-500" />
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-red-700 dark:text-red-400 whitespace-pre-wrap">{displayError}</p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isLoading || !server || !username || !password}
                className="w-full px-4 py-3 bg-pink-500 hover:bg-pink-600 active:bg-pink-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center shadow-md hover:shadow-lg"
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
                <div className="w-full border-t border-gray-200 dark:border-gray-700" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  Quick select
                </span>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              {serverPresets.map((preset) => (
                <button
                  key={preset.url}
                  type="button"
                  onClick={() => handlePresetSelect(preset)}
                  disabled={isLoading}
                  className="w-full flex items-center py-3 px-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="i-lucide:server text-gray-400 dark:text-gray-500 mr-3 flex-shrink-0" />
                  <div className="text-left flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {preset.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {preset.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {import.meta.env.DEV && (
            <div className="mt-6 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg text-xs text-gray-600 dark:text-gray-400">
              <p className="font-semibold mb-1 text-gray-700 dark:text-gray-300">Dev Mode:</p>
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
