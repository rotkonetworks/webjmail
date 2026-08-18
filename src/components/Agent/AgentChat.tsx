import { useState, useRef, useEffect } from 'react'
import { runAgent } from '../../lib/agent'
import { listModels } from '../../lib/llm'
import { useAiProviderStore, isProviderReady, OPENAI_PRESETS } from '../../stores/aiProviderStore'
import { useAgentChatStore } from '../../stores/agentChatStore'
import { useDraftStore } from '../../stores/draftStore'
import { InlineComposer } from '../Message/InlineComposer'

interface AgentChatProps {
  accountId: string | null
  onClose: () => void
  onOpenSettings?: () => void
  // Narrow layout (mobile / browser-extension side panel): show Chat|Draft tabs
  // and host the draft inside the Draft tab instead of as a floating card.
  narrow?: boolean
}

export function AgentChat({ accountId, onClose, narrow = false }: AgentChatProps) {
  // Conversation lives in a store so it survives remounts (mobile<->desktop
  // breakpoint swap, panel close/reopen). Transient UI state stays local.
  const msgs = useAgentChatStore((s) => s.msgs)
  const setMsgs = useAgentChatStore((s) => s.setMsgs)
  const resetChat = useAgentChatStore((s) => s.reset)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [streaming, setStreaming] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const ai = useAiProviderStore()
  const ready = isProviderReady(ai)

  // Chat | Draft tabs (narrow layout only). The draft lives in the Draft tab.
  const draftOpen = useDraftStore((s) => s.open)
  const draftRev = useDraftStore((s) => s.rev)
  const closeDraft = useDraftStore((s) => s.close)
  const [view, setView] = useState<'chat' | 'draft'>('chat')
  // Jump to the Draft tab whenever the assistant creates/edits a draft.
  useEffect(() => {
    if (narrow && draftOpen) setView('draft')
  }, [narrow, draftOpen, draftRev])
  // Fall back to Chat when the draft is closed (sent/discarded).
  useEffect(() => {
    if (!draftOpen && view === 'draft') setView('chat')
  }, [draftOpen, view])

  const providerLabel = ai.model || 'OpenAI-compatible'

  // Inline provider/model config (gear toggle in the header).
  const [showConfig, setShowConfig] = useState(!ready)
  const [models, setModels] = useState<string[]>([])
  const [modelsBusy, setModelsBusy] = useState(false)
  const [modelsErr, setModelsErr] = useState('')

  const refreshModels = async () => {
    setModelsBusy(true)
    setModelsErr('')
    try {
      setModels(await listModels())
    } catch (err) {
      setModelsErr(err instanceof Error ? err.message : 'Failed to list models')
    } finally {
      setModelsBusy(false)
    }
  }

  // Auto-fetch the model list when the config opens and a base URL is set.
  useEffect(() => {
    if (showConfig && ai.baseUrl.trim() && models.length === 0) {
      refreshModels()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showConfig, ai.baseUrl])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [msgs, status, busy, streaming])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    if (!ready) {
      setMsgs((m) => [...m, { role: 'assistant', text: 'Configure an AI provider in Settings first.' }])
      return
    }
    if (!accountId) {
      setMsgs((m) => [...m, { role: 'assistant', text: 'No account is selected yet.' }])
      return
    }
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text }])
    setBusy(true)
    setStatus('Thinking…')
    setStreaming('')
    try {
      const store = useAgentChatStore.getState()
      const { history: next, reply } = await runAgent(
        store.history,
        text,
        { accountId },
        setStatus,
        (delta) => setStreaming((s) => s + delta), // live tokens
        () => setStreaming('') // reset at the start of each model turn
      )
      store.setHistory(next)
      setMsgs((m) => [...m, { role: 'assistant', text: reply }])
    } catch (err) {
      setMsgs((m) => [
        ...m,
        { role: 'assistant', text: `⚠️ ${err instanceof Error ? err.message : String(err)}` },
      ])
    } finally {
      setBusy(false)
      setStatus('')
      setStreaming('')
    }
  }

  return (
    <div className={`h-full w-full bg-[var(--bg-secondary)] flex flex-col ${narrow ? '' : 'border-l border-[var(--border-color)] shadow-2xl'}`}>
      <div className="flex items-center justify-between p-3 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)] min-w-0">
          <div className="i-lucide:sparkles text-[var(--primary-color)] flex-shrink-0" /> Assistant
          <button
            onClick={() => setShowConfig((v) => !v)}
            className="text-xs font-normal text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex items-center gap-1 min-w-0"
            title="Choose AI provider / model"
          >
            <span className="truncate max-w-[140px]">{providerLabel}</span>
            <div className={`i-lucide:chevron-down flex-shrink-0 transition-transform ${showConfig ? 'rotate-180' : ''}`} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (busy) return
              if (msgs.length && !confirm('Start a new chat? The current conversation will be cleared.'))
                return
              resetChat()
              setInput('')
              setStreaming('')
              setStatus('')
            }}
            disabled={busy || msgs.length === 0}
            className="p-1 rounded hover:bg-white/10 disabled:opacity-40"
            title="New chat (clears the current conversation)"
          >
            <div className="i-lucide:square-pen" />
          </button>
          <button
            onClick={() => setShowConfig((v) => !v)}
            className={`p-1 rounded hover:bg-white/10 ${showConfig ? 'text-[var(--primary-color)]' : ''}`}
            title="Provider settings"
          >
            <div className="i-lucide:settings-2" />
          </button>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded" title="Close">
            <div className="i-lucide:x" />
          </button>
        </div>
      </div>

      {/* Chat | Draft tabs — narrow layouts host the draft in the Draft tab. */}
      {narrow && (
        <div className="flex gap-1 p-2 border-b border-[var(--border-color)]">
          <button
            onClick={() => setView('chat')}
            className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              view === 'chat'
                ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => draftOpen && setView('draft')}
            disabled={!draftOpen}
            className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              view === 'draft'
                ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:hover:text-[var(--text-tertiary)]'
            }`}
          >
            Draft
            {draftOpen && <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary-color)]" />}
          </button>
        </div>
      )}

      {showConfig && (
        <div className="border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] p-3 space-y-3 text-sm">
          {/* Presets */}
          <div className="flex flex-wrap gap-1.5">
            {OPENAI_PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => {
                  ai.applyPreset({ baseUrl: p.baseUrl, model: p.model })
                  setModels([])
                }}
                className="px-2 py-1 text-xs rounded border border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors"
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Base URL */}
          <input
            type="text"
            value={ai.baseUrl}
            onChange={(e) => ai.setBaseUrl(e.target.value)}
            placeholder="Base URL — https://openrouter.ai/api/v1"
            className="w-full text-xs bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-2 py-1.5 outline-none focus:border-[var(--primary-color)]"
          />

          {/* Model picker — datalist gives a dropdown of fetched models plus free text */}
          <div className="flex gap-1.5">
            <input
              type="text"
              list="agent-models"
              value={ai.model}
              onChange={(e) => ai.setModel(e.target.value)}
              placeholder="Model — deepseek/deepseek-v4-flash / llama3.1 / …"
              className="flex-1 min-w-0 text-xs bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-2 py-1.5 outline-none focus:border-[var(--primary-color)]"
            />
            <button
              onClick={refreshModels}
              disabled={modelsBusy || !ai.baseUrl.trim()}
              title="Fetch available models"
              className="px-2 rounded border border-[var(--border-color)] hover:bg-[var(--bg-secondary)] disabled:opacity-50 flex items-center"
            >
              <div className={`i-lucide:refresh-cw text-xs ${modelsBusy ? 'animate-spin' : ''}`} />
            </button>
            <datalist id="agent-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          {models.length > 0 && (
            <p className="text-xs text-[var(--text-tertiary)]">
              {models.length} models available — pick from the list or type one.
            </p>
          )}
          {modelsErr && <p className="text-xs text-red-400">{modelsErr}</p>}

          {/* API key */}
          <input
            type="password"
            value={ai.apiKey}
            onChange={(e) => ai.setApiKey(e.target.value)}
            placeholder="API key (blank for local/Ollama)"
            autoComplete="off"
            title="Stored only in this browser and sent only to your provider — never to the webjmail server. The model just decides actions; your browser runs them against your mailbox with your session. Tip: use a spend-limited key you can revoke, or run Ollama locally to keep everything on your machine."
            className="w-full text-xs bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-2 py-1.5 outline-none focus:border-[var(--primary-color)]"
          />
        </div>
      )}

      {narrow && view === 'draft' ? (
        <div className="flex-1 min-h-0">
          <InlineComposer embedded bound onClose={closeDraft} />
        </div>
      ) : (
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {!ready && !showConfig && (
          <div className="text-sm text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg p-3 leading-relaxed">
            <div className="font-medium mb-1">No AI provider configured</div>
            <p className="text-[var(--text-tertiary)]">
              Pick a provider and model up top — e.g. Ollama at{' '}
              <code>http://localhost:11434/v1</code>, or OpenAI with an API key.
            </p>
            <button
              onClick={() => setShowConfig(true)}
              className="btn-primary mt-2 px-3 py-1.5 rounded text-sm"
            >
              Choose provider
            </button>
          </div>
        )}
        {ready && msgs.length === 0 && (
          <div className="text-sm text-[var(--text-tertiary)] leading-relaxed">
            Ask about your mail — e.g.
            <br />• “summarize my unread”
            <br />• “find the last invoice from Hetzner”
            <br />• “draft a reply to the GitHub security email”
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div
              className={`inline-block px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words text-left max-w-[90%] ${
                m.role === 'user'
                  ? 'bg-[var(--primary-color)] text-[var(--on-primary)]'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {/* Live streaming reply */}
        {streaming && (
          <div>
            <div className="inline-block px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words text-left max-w-[90%] bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
              {streaming}
            </div>
          </div>
        )}
        {busy && !streaming && (
          <div className="text-xs text-[var(--text-tertiary)] flex items-center gap-1.5">
            <div className="i-eos-icons:loading animate-spin" /> {status}
          </div>
        )}
      </div>
      )}

      {/* Working indicator — visible in both tabs (the in-transcript one is
          hidden while the Draft tab is showing). */}
      {busy && view === 'draft' && (
        <div className="px-3 py-1.5 text-xs text-[var(--text-tertiary)] flex items-center gap-1.5 border-t border-[var(--border-color)]">
          <div className="i-eos-icons:loading animate-spin" /> {status || 'Working…'}
        </div>
      )}

      <div className="p-3 border-t border-[var(--border-color)] flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          disabled={busy}
          placeholder="Ask your mail…"
          className="flex-1 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 outline-none focus:border-[var(--primary-color)] disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="btn-primary px-3 py-2 rounded text-sm disabled:opacity-50 flex items-center"
          title="Send"
        >
          <div className="i-lucide:send" />
        </button>
      </div>
    </div>
  )
}
