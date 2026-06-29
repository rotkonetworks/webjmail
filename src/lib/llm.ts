// Provider-agnostic chat layer for the in-app assistant.
//
// The agent loop works in a single normalized message format (`Turn`); this
// module serializes that conversation into whichever provider's wire format is
// configured and parses the reply back into a normalized `LlmReply`. Two
// backends are supported:
//   - Claude subscription: proxied through Rust (desktop only, no API key).
//   - OpenAI-compatible: any `/chat/completions` endpoint, called directly from
//     the browser/webview (OpenAI, Ollama, OpenRouter, LM Studio, vLLM, …).
import { jmapClient } from '../api/jmap'
import { useAiProviderStore } from '../stores/aiProviderStore'

export type ToolCall = { id: string; name: string; input: any }

export type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; result: string }

export type ToolDef = { name: string; description: string; parameters: any }

export type LlmReply = { text: string; toolCalls: ToolCall[] }

const MAX_TOKENS = 4096

// --- Anthropic (Claude subscription, via Rust proxy) -----------------------

function toAnthropicMessages(turns: Turn[]): any[] {
  const messages: any[] = []
  for (const t of turns) {
    if (t.role === 'user') {
      messages.push({ role: 'user', content: t.text })
    } else if (t.role === 'assistant') {
      const content: any[] = []
      if (t.text) content.push({ type: 'text', text: t.text })
      for (const tc of t.toolCalls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
      }
      messages.push({ role: 'assistant', content })
    } else {
      // tool result — Anthropic groups results into the user turn that follows
      // the assistant's tool_use blocks.
      const block = { type: 'tool_result', tool_use_id: t.toolCallId, content: t.result }
      const last = messages[messages.length - 1]
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block)
      } else {
        messages.push({ role: 'user', content: [block] })
      }
    }
  }
  return messages
}

async function anthropicChat(turns: Turn[], tools: ToolDef[], system: string): Promise<LlmReply> {
  const resp = await jmapClient.claudeMessage({
    model: useAiProviderStore.getState().claudeModel || 'claude-opus-4-8',
    max_tokens: MAX_TOKENS,
    system,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    messages: toAnthropicMessages(turns),
  })
  if (resp?.type === 'error') throw new Error(resp.error?.message || 'Claude error')

  let text = ''
  const toolCalls: ToolCall[] = []
  for (const block of resp.content || []) {
    if (block.type === 'text') text += (text ? '\n' : '') + block.text
    else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: block.input })
  }
  return { text: text.trim(), toolCalls }
}

// --- OpenAI-compatible (direct fetch) --------------------------------------

function toOpenAiMessages(turns: Turn[], system: string): any[] {
  const messages: any[] = [{ role: 'system', content: system }]
  for (const t of turns) {
    if (t.role === 'user') {
      messages.push({ role: 'user', content: t.text })
    } else if (t.role === 'assistant') {
      const msg: any = { role: 'assistant', content: t.text || null }
      if (t.toolCalls.length) {
        msg.tool_calls = t.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
        }))
      }
      messages.push(msg)
    } else {
      messages.push({ role: 'tool', tool_call_id: t.toolCallId, content: t.result })
    }
  }
  return messages
}

async function openAiChat(turns: Turn[], tools: ToolDef[], system: string): Promise<LlmReply> {
  const { baseUrl, apiKey, model } = useAiProviderStore.getState()
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey.trim()) headers['authorization'] = `Bearer ${apiKey.trim()}`

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: toOpenAiMessages(turns, system),
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: 'auto',
    }),
  })

  const raw = await resp.text()
  if (!resp.ok) throw new Error(`${model || 'provider'} error ${resp.status}: ${raw.slice(0, 500)}`)

  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(`Provider returned non-JSON response: ${raw.slice(0, 200)}`)
  }
  if (data.error) throw new Error(data.error?.message || String(data.error))

  const message = data.choices?.[0]?.message ?? {}
  const text: string = typeof message.content === 'string' ? message.content : ''
  const toolCalls: ToolCall[] = (message.tool_calls || []).map((tc: any, i: number) => {
    let input: any = {}
    try {
      input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}
    } catch {
      input = {}
    }
    return { id: tc.id || `call_${i}`, name: tc.function?.name, input }
  })
  return { text: text.trim(), toolCalls }
}

// --- Streaming --------------------------------------------------------------

export type OnText = (delta: string) => void

type SseEvent = { event?: string; data: string }

// Incrementally split an SSE buffer into complete events (separated by a blank
// line). Returns parsed events + the unconsumed remainder to carry forward.
function drainSSE(buffer: string): { events: SseEvent[]; rest: string } {
  let buf = buffer.replace(/\r\n/g, '\n')
  const events: SseEvent[] = []
  let idx: number
  while ((idx = buf.indexOf('\n\n')) !== -1) {
    const block = buf.slice(0, idx)
    buf = buf.slice(idx + 2)
    let event: string | undefined
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
    }
    if (dataLines.length) events.push({ event, data: dataLines.join('\n') })
  }
  return { events, rest: buf }
}

async function anthropicChatStream(
  turns: Turn[],
  tools: ToolDef[],
  system: string,
  onText: OnText
): Promise<LlmReply> {
  const body = {
    model: useAiProviderStore.getState().claudeModel || 'claude-opus-4-8',
    max_tokens: MAX_TOKENS,
    system,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    messages: toAnthropicMessages(turns),
    stream: true,
  }

  let text = ''
  let errMsg = ''
  let buffer = ''
  const blocks: Record<number, { type?: string; id?: string; name?: string; json: string }> = {}
  const toolCalls: ToolCall[] = []

  await jmapClient.claudeMessageStream(body, (chunk) => {
    buffer += chunk
    const { events, rest } = drainSSE(buffer)
    buffer = rest
    for (const ev of events) {
      let data: any
      try {
        data = JSON.parse(ev.data)
      } catch {
        continue
      }
      const type = data.type || ev.event
      if (type === 'content_block_start') {
        const cb = data.content_block || {}
        blocks[data.index] = { type: cb.type, id: cb.id, name: cb.name, json: '' }
      } else if (type === 'content_block_delta') {
        const d = data.delta || {}
        if (d.type === 'text_delta' && d.text) {
          text += d.text
          onText(d.text)
        } else if (d.type === 'input_json_delta') {
          const b = blocks[data.index]
          if (b) b.json += d.partial_json || ''
        }
      } else if (type === 'content_block_stop') {
        const b = blocks[data.index]
        if (b && b.type === 'tool_use') {
          let input: any = {}
          try {
            input = b.json ? JSON.parse(b.json) : {}
          } catch {
            input = {}
          }
          toolCalls.push({ id: b.id || `t${data.index}`, name: b.name as string, input })
        }
      } else if (type === 'error') {
        errMsg = data.error?.message || 'Claude stream error'
      }
    }
  })

  if (errMsg) throw new Error(errMsg)
  return { text: text.trim(), toolCalls }
}

async function openAiChatStream(
  turns: Turn[],
  tools: ToolDef[],
  system: string,
  onText: OnText
): Promise<LlmReply> {
  const { baseUrl, apiKey, model } = useAiProviderStore.getState()
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey.trim()) headers['authorization'] = `Bearer ${apiKey.trim()}`

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      stream: true,
      messages: toOpenAiMessages(turns, system),
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: 'auto',
    }),
  })
  if (!resp.ok || !resp.body) {
    const raw = await resp.text().catch(() => '')
    throw new Error(`${model || 'provider'} error ${resp.status}: ${raw.slice(0, 500)}`)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const toolAcc: Record<number, { id?: string; name?: string; args: string }> = {}

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const { events, rest } = drainSSE(buffer)
    buffer = rest
    for (const ev of events) {
      if (ev.data === '[DONE]') continue
      let data: any
      try {
        data = JSON.parse(ev.data)
      } catch {
        continue
      }
      if (data.error) throw new Error(data.error?.message || String(data.error))
      const delta = data.choices?.[0]?.delta || {}
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content
        onText(delta.content)
      }
      for (const tc of delta.tool_calls || []) {
        const i = tc.index ?? 0
        const acc = toolAcc[i] || (toolAcc[i] = { args: '' })
        if (tc.id) acc.id = tc.id
        if (tc.function?.name) acc.name = tc.function.name
        if (tc.function?.arguments) acc.args += tc.function.arguments
      }
    }
  }

  const toolCalls: ToolCall[] = Object.entries(toolAcc).map(([i, acc]) => {
    let input: any = {}
    try {
      input = acc.args ? JSON.parse(acc.args) : {}
    } catch {
      input = {}
    }
    return { id: acc.id || `call_${i}`, name: acc.name as string, input }
  })
  return { text: text.trim(), toolCalls }
}

// --- Dispatch ---------------------------------------------------------------

/** Run one model turn using whichever provider is configured. */
export async function llmChat(turns: Turn[], tools: ToolDef[], system: string): Promise<LlmReply> {
  const { provider } = useAiProviderStore.getState()
  return provider === 'openai' ? openAiChat(turns, tools, system) : anthropicChat(turns, tools, system)
}

/** Streaming variant — calls `onText` with text deltas as they arrive. */
export async function llmChatStream(
  turns: Turn[],
  tools: ToolDef[],
  system: string,
  onText: OnText
): Promise<LlmReply> {
  const { provider } = useAiProviderStore.getState()
  return provider === 'openai'
    ? openAiChatStream(turns, tools, system, onText)
    : anthropicChatStream(turns, tools, system, onText)
}

/**
 * List model ids available at the configured OpenAI-compatible endpoint
 * (`GET /models` — supported by OpenAI, Ollama, OpenRouter, LM Studio, …).
 * Returns [] when there's no base URL; throws on a failed request.
 */
export async function listModels(): Promise<string[]> {
  const { baseUrl, apiKey } = useAiProviderStore.getState()
  if (!baseUrl.trim()) return []
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const headers: Record<string, string> = {}
  if (apiKey.trim()) headers['authorization'] = `Bearer ${apiKey.trim()}`

  const resp = await fetch(url, { headers })
  if (!resp.ok) throw new Error(`Could not list models (${resp.status})`)
  const data = await resp.json()
  const list: any[] = data?.data ?? data?.models ?? []
  return list
    .map((m) => (typeof m === 'string' ? m : m?.id || m?.name))
    .filter(Boolean)
    .sort()
}
