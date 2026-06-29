import React, { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { config, validateJMAPServerUrl, getPresetsByCategory } from '../config'
import { bestGuessServer, isLikelyEmail } from '../lib/discovery'

export function Login() {
  // 'auto' = email + password (autodiscover server); 'manual' = full server form.
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Manual fields (pre-filled from discovery / last server on fallback).
  const [server, setServer] = useState(() => {
    try {
      return localStorage.getItem('webjmail:lastServer') || ''
    } catch {
      return ''
    }
  })
  const [username, setUsername] = useState('')

  const [localError, setLocalError] = useState('')
  const [notice, setNotice] = useState('')
  const [serverValidation, setServerValidation] = useState<{ isValid: boolean; error?: string; sanitized?: string }>({ isValid: true })
  const [showPresets, setShowPresets] = useState(false)

  const serverPresets = getPresetsByCategory()
  const { login, loginAuto, isLoading, error: authError, clearError } = useAuthStore()

  useEffect(() => {
    if (authError) {
      setLocalError(authError)
      const timer = setTimeout(() => clearError(), 5000)
      return () => clearTimeout(timer)
    }
  }, [authError, clearError])

  useEffect(() => {
    if (server) setServerValidation(validateJMAPServerUrl(server))
  }, [server])

  // Email + password → discover server, or drop to a pre-filled manual form.
  const handleAutoSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')
    setNotice('')
    if (!isLikelyEmail(email)) {
      setLocalError('Enter a valid email address')
      return
    }
    if (!password) {
      setLocalError('Enter your password')
      return
    }
    try {
      const found = await loginAuto(email, password)
      if (!found) {
        // Couldn't auto-detect — switch to manual, pre-filled with our best guess.
        setUsername(email)
        setServer((s) => s || bestGuessServer(email))
        setMode('manual')
        setNotice("We couldn't detect your mail server automatically. Please confirm the details below.")
      }
    } catch {
      /* handled by store / fallback above */
    }
  }

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')
    if (!server || !username || !password) {
      setLocalError('Please fill in all fields')
      return
    }
    if (!serverValidation.isValid) {
      setLocalError(serverValidation.error || 'Invalid server URL')
      return
    }
    try {
      await login(serverValidation.sanitized || server, username, password)
    } catch {
      /* error handled by store */
    }
  }

  const goManual = () => {
    if (email && !username) setUsername(email)
    if (email && !server) setServer(bestGuessServer(email))
    setNotice('')
    setLocalError('')
    setMode('manual')
  }

  const goAuto = () => {
    setNotice('')
    setLocalError('')
    setMode('auto')
  }

  const handlePresetSelect = (preset: { url: string }) => {
    setServer(preset.url)
    setLocalError('')
    setShowPresets(false)
  }

  const displayError = localError || authError

  const inputClass =
    'w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-md text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] focus:border-[var(--primary-color)] disabled:opacity-50 disabled:cursor-not-allowed transition-all'

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-[var(--primary-color)] rounded-2xl flex items-center justify-center shadow-lg">
            <div className="i-lucide:mail text-[var(--on-primary)] text-3xl" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold text-[var(--text-primary)]">{config.appName}</h2>
        <p className="mt-2 text-center text-sm text-[var(--text-secondary)]">Sign in to your email account</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-[var(--bg-secondary)] py-8 px-4 shadow-xl rounded-lg sm:px-10 border border-[var(--border-color)]">
          {notice && (
            <div className="mb-4 rounded-md bg-[var(--accent-orange)]/10 border border-[var(--accent-orange)]/30 p-3">
              <p className="text-xs text-[var(--accent-orange)]">{notice}</p>
            </div>
          )}

          {mode === 'auto' ? (
            <form className="space-y-6" onSubmit={handleAutoSubmit} autoComplete="on" noValidate>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                  Email address
                </label>
                <input
                  id="email"
                  name="username"
                  type="email"
                  autoComplete="username"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  required
                  disabled={isLoading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="you@example.com"
                />
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  We'll find your mail server automatically.
                </p>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-[var(--text-primary)] mb-1">
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
                  className={inputClass}
                  placeholder="••••••••"
                />
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">Use an app password if 2FA is enabled.</p>
              </div>

              {displayError && <ErrorBox message={displayError} />}

              <button
                type="submit"
                disabled={isLoading || !email || !password}
                className="w-full px-4 py-3 bg-[var(--primary-color)] hover:bg-[var(--primary-hover)] active:opacity-90 text-[var(--on-primary)] rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center shadow-md hover:shadow-lg"
              >
                {isLoading ? (
                  <>
                    <div className="i-eos-icons:loading animate-spin mr-2" />
                    Connecting…
                  </>
                ) : (
                  'Sign in'
                )}
              </button>

              <button
                type="button"
                onClick={goManual}
                disabled={isLoading}
                className="w-full text-center text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
              >
                Enter server settings manually
              </button>
            </form>
          ) : (
            <form className="space-y-6" onSubmit={handleManualSubmit} autoComplete="on" noValidate>
              <div>
                <label htmlFor="server" className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                  JMAP Server
                </label>
                <div className="relative">
                  <input
                    id="server"
                    name="server"
                    type="text"
                    required
                    disabled={isLoading}
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    className={`${inputClass} pr-12 ${serverValidation.isValid ? '' : 'border-red-500 focus:ring-red-500'}`}
                    placeholder="mail.example.com or full URL"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPresets(!showPresets)}
                    disabled={isLoading}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                  >
                    <div className="i-lucide:chevron-down" />
                  </button>
                </div>
                {!serverValidation.isValid && <p className="mt-1 text-xs text-red-400">{serverValidation.error}</p>}
              </div>

              <div>
                <label htmlFor="username" className="block text-sm font-medium text-[var(--text-primary)] mb-1">
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
                  className={inputClass}
                  placeholder="you@example.com"
                />
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Usually your full email address (some servers use just the username).
                </p>
              </div>

              <div>
                <label htmlFor="password-m" className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                  Password
                </label>
                <input
                  id="password-m"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={isLoading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder="••••••••"
                />
              </div>

              {displayError && <ErrorBox message={displayError} />}

              <button
                type="submit"
                disabled={isLoading || !server || !username || !password}
                className="w-full px-4 py-3 bg-[var(--primary-color)] hover:bg-[var(--primary-hover)] active:opacity-90 text-[var(--on-primary)] rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center shadow-md hover:shadow-lg"
              >
                {isLoading ? (
                  <>
                    <div className="i-eos-icons:loading animate-spin mr-2" />
                    Authenticating…
                  </>
                ) : (
                  'Sign in'
                )}
              </button>

              <button
                type="button"
                onClick={goAuto}
                disabled={isLoading}
                className="w-full text-center text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
              >
                ← Back to quick sign-in
              </button>
            </form>
          )}

          {mode === 'manual' && showPresets && (
            <div className="mt-6 space-y-2">
              <div className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">Server presets</div>
              {[
                ...serverPresets.recommended,
                ...serverPresets.popular,
                ...serverPresets.selfhosted,
                ...serverPresets.enterprise,
                ...serverPresets.opensource,
              ].map((preset) => (
                <button
                  key={preset.url}
                  type="button"
                  onClick={() => handlePresetSelect(preset)}
                  disabled={isLoading}
                  className="w-full flex items-center py-2.5 px-3 border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50 text-left"
                >
                  <div className="i-lucide:server text-[var(--text-tertiary)] mr-3 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)]">{preset.name}</div>
                    <div className="text-xs text-[var(--text-tertiary)] truncate">{preset.description}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-red-500/10 border border-red-500/30 p-4">
      <div className="flex">
        <div className="i-lucide:alert-circle text-red-500 flex-shrink-0" />
        <p className="ml-3 text-sm text-red-400 whitespace-pre-wrap">{message}</p>
      </div>
    </div>
  )
}
