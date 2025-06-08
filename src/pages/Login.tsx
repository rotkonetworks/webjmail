import React, { useState } from 'react'

interface AuthStore {
  login: (server: string, username: string, password: string) => Promise<void>
}

// Mock store for demo - in real app this would be imported
const useAuthStore = (): { login: AuthStore['login'] } => ({
  login: async (server, username, password) => {
    console.log('Login:', { server, username, password })
  }
})

export function Login() {
  const [server, setServer] = useState('https://jmap.fastmail.com/.well-known/jmap')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  
  const { login } = useAuthStore()
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    
    try {
      await login(server, username, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="i-lucide:mail text-6xl text-primary" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          JMAP Email Client
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Sign in with your JMAP server credentials
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
                  type="url"
                  required
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  className="input w-full"
                  placeholder="https://jmap.example.com/.well-known/jmap"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Enter your JMAP server's discovery URL
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
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input w-full"
                  placeholder="user@example.com"
                />
              </div>
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
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input w-full"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-red-50 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <div className="i-lucide:x-circle text-red-400" />
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={loading}
                className="btn w-full flex justify-center items-center"
              >
                {loading ? (
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

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Popular JMAP Servers</span>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              <button
                type="button"
                onClick={() => {
                  setServer('https://jmap.fastmail.com/.well-known/jmap')
                  setUsername('')
                  setPassword('')
                }}
                className="w-full inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <div className="i-simple-icons:fastmail mr-2" />
                Fastmail
              </button>
              
              <button
                type="button"
                onClick={() => {
                  setServer('https://localhost:8080/.well-known/jmap')
                  setUsername('')
                  setPassword('')
                }}
                className="w-full inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <div className="i-lucide:server mr-2" />
                Local Server (Development)
              </button>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-center text-xs text-gray-500">
              Need a JMAP account?{' '}
              <a
                href="https://www.fastmail.com/jmap/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary-dark"
              >
                Learn more about JMAP
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
