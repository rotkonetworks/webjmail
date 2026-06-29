import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isTauri } from '../lib/tauri'

// Which backend powers the in-app assistant.
//  - 'claude-subscription': desktop-only. Calls go through Rust using the user's
//    Claude Code login (no API key). Zero-config default in the desktop build.
//  - 'openai': any OpenAI-compatible /chat/completions endpoint — OpenAI itself,
//    Ollama (http://localhost:11434/v1), OpenRouter, LM Studio, vLLM, etc.
//    Called directly from the browser/webview with the configured base URL/key.
export type AiProvider = 'claude-subscription' | 'openai'

interface AiProviderState {
  provider: AiProvider
  baseUrl: string
  apiKey: string
  model: string
  // Model used on the Claude-subscription path (separate from the OpenAI `model`).
  claudeModel: string
  setProvider: (p: AiProvider) => void
  setBaseUrl: (v: string) => void
  setApiKey: (v: string) => void
  setModel: (v: string) => void
  setClaudeModel: (v: string) => void
  applyPreset: (p: { baseUrl: string; model: string }) => void
}

export const useAiProviderStore = create<AiProviderState>()(
  persist(
    (set) => ({
      // Desktop defaults to the subscription path; the browser has no Rust proxy
      // so it must use a configured OpenAI-compatible provider.
      provider: isTauri ? 'claude-subscription' : 'openai',
      baseUrl: '',
      apiKey: '',
      model: '',
      claudeModel: 'claude-opus-4-8',
      setProvider: (provider) => set({ provider }),
      setBaseUrl: (baseUrl) => set({ baseUrl }),
      setApiKey: (apiKey) => set({ apiKey }),
      setModel: (model) => set({ model }),
      setClaudeModel: (claudeModel) => set({ claudeModel }),
      applyPreset: ({ baseUrl, model }) => set({ provider: 'openai', baseUrl, model }),
    }),
    { name: 'webjmail:ai-provider' }
  )
)

/** Whether the currently selected provider has enough config to be used. */
export function isProviderReady(s: Pick<AiProviderState, 'provider' | 'baseUrl' | 'model'>): boolean {
  if (s.provider === 'claude-subscription') return isTauri
  return !!s.baseUrl.trim() && !!s.model.trim()
}

// Claude models available on the subscription path.
export const CLAUDE_MODELS = [
  { id: 'claude-opus-4-8', name: 'Opus 4.8 — highest quality' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6 — faster' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5 — fastest' },
]

// Handy presets for the settings UI.
export const OPENAI_PRESETS = [
  { name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet' },
]
