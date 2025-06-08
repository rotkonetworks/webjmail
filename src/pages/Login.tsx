import React, { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { config, serverPresets } from '../config'

export function Login() {
  // Use the default server from config
  const [server, setServer] = useState(config.defaultServer)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState('')
  
  const { login, isLoading, error: authError, clearError } = useAuthStore()
  
  // Show auth store errors
  useEffect(() => {
    if (authError) {
      setLocalError(authError)
      // Clear the error from the store after showing it
      const timer = setTimeout(() => clearError(), 5000)
      return () => clearTimeout(timer)
    }
  }, [authError, clearError])
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')
    
    // Basic validation
    if (!server || !username || !password) {
      setLocalError('Please fill in all fields')
      return
    }
    
    console.log('[Login] Submitting login form...', { 
      server, 
      username,
      // Log first few chars of password for debugging
      passwordLength: password.length,
      passwordPrefix: password.substring(0, 3) + '***'
    })
    
    try {
      await login(server, username, password)
      console.log('[Login] Login successful')
    } catch (err) {
      console.error('[Login] Login error:', err)
      // Error is already set in the store, just log it here
    }
  }
  
  const displayError = localError || authError
  
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="i-lucide:mail text-6xl text-primary" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Rotko Mail
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Sign in to your Stalwart mail account
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="server" className="block text-sm font-medium text-gray-700">
                JMAP Server URL
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
                  className="input w-full disabled:opacity-50 disabled:bg-gray-100"
                  placeholder="/.well-known/jmap or https://mail.rotko.net/.well-known/jmap"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Default: Rotko Stalwart Mail Server (no port needed)
              </p>
            </div>

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700">
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
                  className="input w-full disabled:opacity-50 disabled:bg-gray-100"
                  placeholder="username (without @domain)"
                  autoFocus
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Enter just the username part (e.g., "peering" not "peering@rotko.net")
              </p>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
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
                  className="input w-full disabled:opacity-50 disabled:bg-gray-100"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Use an app password from Stalwart if 2FA is enabled
              </p>
            </div>

            {displayError && (
              <div className="rounded-md bg-red-50 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <div className="i-lucide:x-circle text-red-400" />
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-red-800 whitespace-pre-wrap">{displayError}</p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="btn w-full flex justify-center items-center"
              >
                {isLoading ? (
                  <>
                    <div className="i-eos-icons:loading animate-spin mr-2" />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </div>
          </form>

          {/* Debug info in development */}
          {import.meta.env.DEV && (
            <div className="mt-4 p-3 bg-gray-100 rounded text-xs text-gray-600">
              <p className="font-semibold mb-1">Debug Info:</p>
              <p>• Check browser console (F12) for detailed logs</p>
              <p>• Network tab shows actual HTTP requests</p>
              <p>• Common issues: CORS, SSL certs, wrong URL format</p>
              <p>• Username format: just the username, not full email</p>
            </div>
          )}

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Server Presets</span>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
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
                  className="w-full inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="i-lucide:server mr-2" />
                  <div className="text-left flex-1">
                    <div>{preset.name}</div>
                    <div className="text-xs text-gray-500">{preset.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <p className="text-center text-xs text-gray-500">
              Powered by{' '}
              <a
                href="https://stalw.art/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary-dark"
              >
                Stalwart Mail Server
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
