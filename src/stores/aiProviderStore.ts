import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// The in-app assistant runs on any OpenAI-compatible /chat/completions endpoint —
// OpenRouter (default), Ollama (http://localhost:11434/v1), OpenAI, LM Studio,
// vLLM, etc. Calls go directly from the browser/webview with the configured base
// URL + key. (An earlier build also had a desktop-only "Claude subscription"
// path that reused the Claude Code login; that has been removed — router only.)
export type AiProvider = 'openai'

interface AiProviderState {
  provider: AiProvider
  baseUrl: string
  apiKey: string
  model: string
  setBaseUrl: (v: string) => void
  setApiKey: (v: string) => void
  setModel: (v: string) => void
  applyPreset: (p: { baseUrl: string; model: string }) => void
}

// Zero-config default: OpenRouter (huge model catalog, browser-CORS-friendly)
// with DeepSeek V4 Flash — cheap, fast, tool-calling capable. The user just
// pastes an OpenRouter API key; everything else is pre-filled.
export const DEFAULT_BASEURL = 'https://openrouter.ai/api/v1'
export const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash'
// Slugs that used to be defaults but no longer exist on the provider — migrate
// anyone still holding one onto the current default so the assistant isn't
// silently broken (dead slug -> 400, and the datalist filters to nothing).
const DEAD_MODELS = new Set(['anthropic/claude-3.5-sonnet'])

export const useAiProviderStore = create<AiProviderState>()(
  persist(
    (set) => ({
      provider: 'openai',
      baseUrl: DEFAULT_BASEURL,
      apiKey: '',
      model: DEFAULT_MODEL,
      setBaseUrl: (baseUrl) => set({ baseUrl }),
      setApiKey: (apiKey) => set({ apiKey }),
      setModel: (model) => set({ model }),
      applyPreset: ({ baseUrl, model }) => set({ baseUrl, model }),
    }),
    {
      name: 'webjmail:ai-provider',
      version: 2,
      migrate: (persisted: any) => {
        const s = persisted || {}
        // The subscription path is gone — force everyone onto the router.
        s.provider = 'openai'
        // Replace a now-dead model slug with the current default.
        if (DEAD_MODELS.has(s.model)) s.model = DEFAULT_MODEL
        // Anyone who never configured a base URL (incl. old desktop-subscription
        // users) gets OpenRouter + DeepSeek.
        if (!String(s.baseUrl || '').trim()) {
          s.baseUrl = DEFAULT_BASEURL
          if (!String(s.model || '').trim()) s.model = DEFAULT_MODEL
        }
        return s
      },
    }
  )
)

/** Whether the assistant has enough config to be used. */
export function isProviderReady(s: Pick<AiProviderState, 'baseUrl' | 'model'>): boolean {
  return !!s.baseUrl.trim() && !!s.model.trim()
}

// Handy presets for the settings UI.
export const OPENAI_PRESETS = [
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-v4-flash' },
  { name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
]
