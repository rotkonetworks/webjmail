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
- search_mail / read_email: find and read messages. Read full content before answering or drafting. read_email also lists any files attached to that message (name + id) so you can re-attach them.
- draft_email: open a NEW draft in the composer (replaces any current draft). Use when the user asks you to write a fresh message or a reply.
- read_draft: read the draft currently open in the composer (to/cc/subject/body and any attachments). Call this BEFORE editing so you edit the user's latest text, not a stale copy.
- update_draft: edit the OPEN draft in place — pass only the fields you want to change (e.g. just body to rewrite it, or just subject). Use this for follow-ups like "make it more formal", "shorten it", "add a closing line", "change the subject".
- attach_from_email: attach a file that is already on an existing message onto the OPEN draft. Pass the source email id (from search_mail/read_email) and optionally a filename to pick a specific file; omit filename to attach all of that message's files. Use this when the user wants to send back / forward a document they received (e.g. "attach the form they sent" or "reply and include their doc"). A draft must be open first — call draft_email if none is.

You can attach files that already live on a message the user received, but you cannot create or fill in file contents yourself, and you cannot upload files from the user's disk — for that, tell the user to use the paperclip button in the composer. The user edits the same draft by hand at the same time, so always read_draft before update_draft when continuing an edit. You write and revise the email so the user doesn't have to type it themselves; you NEVER send mail — the user reviews and sends from the composer. Keep chat answers concise and reference concrete senders/subjects/dates.`

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
      'Read the draft currently open in the composer (to, cc, subject, body, and attached file names). Call before update_draft so you edit the latest text the user may have changed by hand.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'attach_from_email',
    description:
      "Attach a file that already exists on another message onto the OPEN draft, by re-referencing it (no re-upload). Use to send back or forward a document the user received. Provide the source email's id; optionally give a filename to select one file, else all files on that message are attached. A draft must already be open.",
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'id of the email that has the attachment(s)' },
        filename: {
          type: 'string',
          description:
            'optional — attach only files whose name contains this text (case-insensitive); omit to attach all',
        },
      },
      required: ['id'],
    },
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

// Normalize a message's attachments to the {blobId,type,name,size} shape the
// draft/composer and send path expect. Skips inline parts with no blobId.
function attachmentsOf(email: Email): Array<{ blobId: string; type: string; name: string; size: number }> {
  return ((email as any).attachments || [])
    .filter((a: any) => a.blobId)
    .map((a: any) => ({
      blobId: a.blobId,
      type: a.type || 'application/octet-stream',
      name: a.name || 'attachment',
      size: a.size || 0,
    }))
}

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
      const files = attachmentsOf(e)
      return JSON.stringify({
        id: e.id,
        from: e.from,
        to: e.to,
        subject: e.subject,
        date: e.receivedAt,
        body: plainText(e),
        attachments: files.map((a) => ({ name: a.name, type: a.type, size: a.size })),
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
      return JSON.stringify({
        to: d.to,
        cc: d.cc,
        subject: d.subject,
        body: d.body,
        attachments: d.attachments.map((a) => a.name),
      })
    }
    if (name === 'attach_from_email') {
      const d = draftSnapshot()
      if (!d.open)
        return 'No draft is open to attach to. Use draft_email to start one first, then attach.'
      const e = await jmapClient.getEmailById(deps.accountId, String(input?.id))
      if (!e) return 'Source email not found.'
      let files = attachmentsOf(e)
      const wanted = input?.filename ? String(input.filename).toLowerCase() : ''
      if (wanted) files = files.filter((a) => a.name.toLowerCase().includes(wanted))
      if (!files.length)
        return wanted
          ? `No attachment matching "${input.filename}" on that message.`
          : 'That message has no attachments to attach.'
      useDraftStore.getState().addAttachments(files)
      return `Attached to the draft: ${files.map((a) => a.name).join(', ')}. The user can review and send from the composer.`
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
