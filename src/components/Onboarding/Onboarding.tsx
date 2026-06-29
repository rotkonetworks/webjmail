// First-run onboarding wizard. Shown once (persisted via localStorage) before
// the login screen for new users. Replaces the previously hardcoded personal
// defaults (server, theme, provider) with explicit user choices, and gates
// credential storage behind a "this is my personal device" consent.
import { useState } from 'react'
import { config, serverPresets } from '../../config'
import { useUIStore } from '../../stores/uiStore'
import {
  useAiProviderStore,
  OPENAI_PRESETS,
  CLAUDE_MODELS,
  type AiProvider,
} from '../../stores/aiProviderStore'
import { isTauri } from '../../lib/tauri'

const ONBOARDED_KEY = 'webjmail:onboarded'
const CONSENT_KEY = 'webjmail:deviceConsent'

type Theme = 'system' | 'dark' | 'light'

interface OnboardingProps {
  onDone: () => void
}

const STEPS = ['Welcome', 'Server', 'Assistant', 'Preferences'] as const

export function Onboarding({ onDone }: OnboardingProps) {
  const [step, setStep] = useState(0)

  // Step 1 — consent
  const [consent, setConsent] = useState(false)

  // Step 2 — server
  const [server, setServer] = useState('')

  // Step 3 — AI provider
  const ai = useAiProviderStore()
  const [aiChoice, setAiChoice] = useState<'skip' | AiProvider>('skip')

  // Step 4 — preferences
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const viewMode = useUIStore((s) => s.viewMode)
  const setViewMode = useUIStore((s) => s.setViewMode)

  const applyTheme = (t: Theme) => {
    setTheme(t)
    if (t === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', t)
  }

  const canNext = step !== 0 || consent

  const finish = () => {
    if (server.trim()) localStorage.setItem('webjmail:lastServer', server.trim())
    if (aiChoice !== 'skip') ai.setProvider(aiChoice)
    localStorage.setItem(CONSENT_KEY, 'true')
    localStorage.setItem(ONBOARDED_KEY, 'true')
    onDone()
  }

  const next = () => (step < STEPS.length - 1 ? setStep((s) => s + 1) : finish())
  const back = () => setStep((s) => Math.max(0, s - 1))

  return (
    <div className="h-screen overflow-auto flex items-center justify-center bg-[var(--bg-primary)] p-4">
      <div className="w-full max-w-lg min-w-0 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header / progress */}
        <div className="p-5 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-[var(--proton-purple)] rounded-lg flex items-center justify-center">
              <div className="i-lucide:mail text-[var(--on-primary)]" />
            </div>
            <span className="font-semibold text-[var(--text-primary)]">{config.appName}</span>
          </div>
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= step ? 'bg-[var(--primary-color)]' : 'bg-[var(--bg-tertiary)]'
                }`}
                title={s}
              />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 text-[var(--text-primary)]">
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Welcome to {config.appName}</h2>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                A fast, local-first email client. Your messages are cached on this device for
                offline access, and your credentials{isTauri ? ' (encrypted)' : ''} and any AI
                API keys are stored <strong>locally on this machine</strong> — never sent to us.
              </p>
              <label className="flex items-start gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 flex-shrink-0"
                />
                <span className="text-sm text-[var(--text-secondary)]">
                  I understand that credentials and API keys are stored locally, and I confirm
                  this is my personal device.
                </span>
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Connect your mail server</h2>
              <p className="text-sm text-[var(--text-secondary)]">
                Enter your JMAP server, or pick a preset. You can change this at the login screen.
              </p>
              <input
                type="text"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="mail.example.com or full .well-known/jmap URL"
                className="w-full text-sm bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg px-3 py-2 outline-none focus:border-[var(--primary-color)]"
              />
              <div className="flex flex-wrap gap-2">
                {serverPresets.map((p) => (
                  <button
                    key={p.url}
                    onClick={() => setServer(p.url)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      server === p.url
                        ? 'border-[var(--primary-color)] text-[var(--primary-color)]'
                        : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                    title={p.description}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">AI assistant (optional)</h2>
              <p className="text-sm text-[var(--text-secondary)]">
                Add an assistant to search, summarize and draft mail. You can skip and set this up
                later in Settings.
              </p>
              <div className="grid grid-cols-1 gap-2">
                <ChoiceRow active={aiChoice === 'skip'} onClick={() => setAiChoice('skip')} title="Skip for now" desc="No assistant — decide later" />
                {isTauri && (
                  <ChoiceRow
                    active={aiChoice === 'claude-subscription'}
                    onClick={() => setAiChoice('claude-subscription')}
                    title="Claude subscription"
                    desc="Use your Claude login — no API key"
                  />
                )}
                <ChoiceRow active={aiChoice === 'openai'} onClick={() => setAiChoice('openai')} title="OpenAI-compatible" desc="OpenAI, Ollama, OpenRouter, LM Studio…" />
              </div>

              {aiChoice === 'claude-subscription' && (
                <div className="space-y-2">
                  <label className="block text-xs text-[var(--text-tertiary)]">Model</label>
                  <select
                    value={ai.claudeModel}
                    onChange={(e) => ai.setClaudeModel(e.target.value)}
                    className="w-full text-sm bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg px-3 py-2 outline-none focus:border-[var(--primary-color)]"
                  >
                    {CLAUDE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {aiChoice === 'openai' && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {OPENAI_PRESETS.map((p) => (
                      <button
                        key={p.name}
                        onClick={() => ai.applyPreset({ baseUrl: p.baseUrl, model: p.model })}
                        className="px-2 py-1 text-xs rounded border border-[var(--border-color)] hover:bg-[var(--bg-tertiary)]"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={ai.baseUrl}
                    onChange={(e) => ai.setBaseUrl(e.target.value)}
                    placeholder="Base URL — http://localhost:11434/v1"
                    className="w-full text-sm bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg px-3 py-2 outline-none focus:border-[var(--primary-color)]"
                  />
                  <input
                    type="text"
                    value={ai.model}
                    onChange={(e) => ai.setModel(e.target.value)}
                    placeholder="Model — gpt-4o / llama3.1 / …"
                    className="w-full text-sm bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg px-3 py-2 outline-none focus:border-[var(--primary-color)]"
                  />
                  <input
                    type="password"
                    value={ai.apiKey}
                    onChange={(e) => ai.setApiKey(e.target.value)}
                    placeholder="API key (blank for local/Ollama)"
                    autoComplete="off"
                    className="w-full text-sm bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg px-3 py-2 outline-none focus:border-[var(--primary-color)]"
                  />
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Preferences</h2>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-[var(--text-secondary)]">Theme</label>
                <div className="flex gap-2">
                  {(['system', 'dark', 'light'] as Theme[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => applyTheme(t)}
                      className={`flex-1 px-3 py-2 text-sm rounded-lg border capitalize transition-colors ${
                        theme === t
                          ? 'border-[var(--primary-color)] text-[var(--primary-color)]'
                          : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-[var(--text-secondary)]">Layout</label>
                <div className="flex gap-2">
                  {(['column', 'row'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setViewMode(m)}
                      className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                        viewMode === m
                          ? 'border-[var(--primary-color)] text-[var(--primary-color)]'
                          : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      {m === 'column' ? 'Split (list + reading pane)' : 'Single column'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border-color)] flex items-center justify-between">
          <button
            onClick={back}
            disabled={step === 0}
            className="px-3 py-2 text-sm rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-0"
          >
            Back
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && step < STEPS.length - 1 && (
              <button onClick={next} className="px-3 py-2 text-sm rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                Skip
              </button>
            )}
            <button
              onClick={next}
              disabled={!canNext}
              className="btn-primary px-5 py-2 text-sm rounded-lg disabled:opacity-50"
            >
              {step === STEPS.length - 1 ? 'Get started' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChoiceRow({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean
  onClick: () => void
  title: string
  desc: string
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-3 rounded-lg border transition-colors ${
        active
          ? 'border-[var(--primary-color)] bg-[var(--bg-tertiary)]'
          : 'border-[var(--border-color)] hover:bg-[var(--bg-tertiary)]'
      }`}
    >
      <div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>
      <div className="text-xs text-[var(--text-tertiary)]">{desc}</div>
    </button>
  )
}

export function hasOnboarded(): boolean {
  return localStorage.getItem(ONBOARDED_KEY) === 'true'
}

export function markOnboarded(): void {
  localStorage.setItem(ONBOARDED_KEY, 'true')
}
