// In-app email assistant: a tool-use loop that searches/reads the user's mail
// and drafts replies. Model calls go through `llmChat`, which targets whichever
// provider the user configured (Claude subscription via Rust, or any
// OpenAI-compatible endpoint called directly).
import { jmapClient } from '../api/jmap'
import { llmChatStream, type Turn, type ToolDef } from './llm'
import { useDraftStore, draftSnapshot } from '../stores/draftStore'
import type { Email } from '../api/types'

export interface AgentDeps {
  accountId: string
}

export type ChatMsg = { role: 'user' | 'assistant'; text: string }

const SYSTEM = `You are an email assistant embedded in Webjmail, a JMAP email client. You help the user triage, search, read, write, and edit email for the account they are currently viewing.

Tools:
- search_mail / read_email: find and read messages. Read full content before answering or drafting.
- draft_email: open a NEW draft in the composer (replaces any current draft). Use when the user asks you to write a fresh message or a reply.
- read_draft: read the draft currently open in the composer (to/cc/subject/body). Call this BEFORE editing so you edit the user's latest text, not a stale copy.
- update_draft: edit the OPEN draft in place — pass only the fields you want to change (e.g. just body to rewrite it, or just subject). Use this for follow-ups like "make it more formal", "shorten it", "add a closing line", "change the subject".

The user edits the same draft by hand at the same time, so always read_draft before update_draft when continuing an edit. You write and revise the email so the user doesn't have to type it themselves; you NEVER send mail — the user reviews and sends from the composer. Keep chat answers concise and reference concrete senders/subjects/dates.`

const TOOLS: ToolDef[] = [
  {
    name: 'search_mail',
    description:
      'Search the mailbox by text across subject, sender and body. Returns up to 15 matches, each with id, from, name, subject, date, preview.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'free-text search' } },
      required: ['query'],
    },
  },
  {
    name: 'read_email',
    description: 'Read the full plain-text body and headers of one email by its id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'draft_email',
    description:
      'Open a NEW pre-filled draft in the composer for the user to review and send (replaces any current draft). Use for new messages and replies. Never sends automatically.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'comma-separated recipients' },
        cc: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        reply_to_id: { type: 'string', description: 'id of the email being replied to, if any' },
      },
      required: ['body'],
    },
  },
  {
    name: 'read_draft',
    description:
      'Read the draft currently open in the composer (to, cc, subject, body). Call before update_draft so you edit the latest text the user may have changed by hand.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'update_draft',
    description:
      'Edit the draft currently open in the composer in place. Pass ONLY the fields you want to change — omitted fields are left as-is. Use for revisions like rewording the body, changing the subject, or adjusting recipients.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'comma-separated recipients' },
        cc: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'full replacement body text' },
      },
    },
  },
]

function plainText(email: Email): string {
  const parts = (email.textBody?.length ? email.textBody : email.htmlBody) || []
  const raw = parts.map((p: any) => email.bodyValues?.[p.partId]?.value || '').join('\n')
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .slice(0, 8000)
}

async function dispatch(name: string, input: any, deps: AgentDeps): Promise<string> {
  try {
    if (name === 'search_mail') {
      const res = await jmapClient.searchEmails(deps.accountId, String(input?.query || ''), 15)
      return JSON.stringify(
        res.map((e) => ({
          id: e.id,
          from: e.from?.[0]?.email,
          name: e.from?.[0]?.name,
          subject: e.subject,
          date: e.receivedAt,
          preview: e.preview,
        }))
      )
    }
    if (name === 'read_email') {
      const e = await jmapClient.getEmailById(deps.accountId, String(input?.id))
      if (!e) return 'Email not found.'
      return JSON.stringify({
        id: e.id,
        from: e.from,
        to: e.to,
        subject: e.subject,
        date: e.receivedAt,
        body: plainText(e),
      })
    }
    if (name === 'draft_email') {
      useDraftStore.getState().openDraft({
        to: input?.to ?? '',
        cc: input?.cc ?? '',
        subject: input?.subject ?? '',
        body: String(input?.body || ''),
        replyToId: input?.reply_to_id,
        mode: input?.reply_to_id ? 'reply' : 'compose',
      })
      return 'Draft opened in the composer for the user to review and send.'
    }
    if (name === 'read_draft') {
      const d = draftSnapshot()
      if (!d.open) return 'No draft is currently open. Use draft_email to start one.'
      return JSON.stringify({ to: d.to, cc: d.cc, subject: d.subject, body: d.body })
    }
    if (name === 'update_draft') {
      const d = draftSnapshot()
      if (!d.open) return 'No draft is open to edit. Use draft_email to start one first.'
      const patch: Record<string, string> = {}
      for (const f of ['to', 'cc', 'subject', 'body'] as const) {
        if (input?.[f] !== undefined && input?.[f] !== null) patch[f] = String(input[f])
      }
      if (!Object.keys(patch).length) return 'No fields provided to update.'
      useDraftStore.getState().applyAgentEdit(patch)
      return `Draft updated (${Object.keys(patch).join(', ')}).`
    }
    return `Unknown tool: ${name}`
  } catch (err) {
    return `Tool error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// Run one user turn through the tool-use loop. `history` is the prior normalized
// conversation; returns the updated history + the assistant's final text.
// `onText` streams the model's text deltas as they arrive; `onTurn` fires at the
// start of each model turn so the UI can reset its live buffer between turns.
export async function runAgent(
  history: Turn[],
  userText: string,
  deps: AgentDeps,
  onStatus?: (s: string) => void,
  onText?: (delta: string) => void,
  onTurn?: () => void
): Promise<{ history: Turn[]; reply: string }> {
  const turns: Turn[] = [...history, { role: 'user', text: userText }]

  for (let step = 0; step < 8; step++) {
    onStatus?.(step === 0 ? 'Thinking…' : 'Working…')
    onTurn?.()
    const { text, toolCalls } = await llmChatStream(turns, TOOLS, SYSTEM, (d) => onText?.(d))

    turns.push({ role: 'assistant', text, toolCalls })

    if (toolCalls.length) {
      for (const tc of toolCalls) {
        onStatus?.(`Using ${tc.name.replace(/_/g, ' ')}…`)
        const result = await dispatch(tc.name, tc.input, deps)
        turns.push({ role: 'tool', toolCallId: tc.id, name: tc.name, result })
      }
      continue
    }

    return { history: turns, reply: text || '(no response)' }
  }

  return { history: turns, reply: 'Stopped after too many steps — try narrowing the request.' }
}
