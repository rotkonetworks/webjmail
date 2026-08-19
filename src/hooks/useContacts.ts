import { useEffect, useState } from 'react'
import { syncManager } from '../db/sync'
import { useCurrentUserId } from './useIndexedDB'

export interface Contact {
  email: string
  name?: string
  n: number // how many times we've seen this address (frequency rank)
}

// Cheap module-level cache so opening several composers doesn't rescan the
// whole mail cache each time. Keyed by user; refreshed when the user changes.
let cache: { userId: string; contacts: Contact[] } | null = null

/**
 * Everyone the current user has corresponded with, derived from mail already in
 * the local index (no server round-trip). Ranked by frequency. Used for
 * recipient autocomplete in the composer.
 */
export function useContacts(): Contact[] {
  const userId = useCurrentUserId()
  const [contacts, setContacts] = useState<Contact[]>(
    cache && cache.userId === userId ? cache.contacts : []
  )

  useEffect(() => {
    if (!userId) return
    if (cache && cache.userId === userId) {
      setContacts(cache.contacts)
      return
    }
    let cancelled = false
    syncManager.getContacts(userId).then((c) => {
      if (cancelled) return
      cache = { userId, contacts: c }
      setContacts(c)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  return contacts
}

/**
 * Rank contacts against a typed fragment. Subsequence ("fuzzy") match on both
 * the email and the display name, so typing "stt" matches "…@stt.co.th" or
 * "Somchai @ STT". Exact prefix/substring hits rank above scattered ones, then
 * by how often the address appears in the mailbox.
 */
export function rankContacts(contacts: Contact[], query: string, limit = 8): Contact[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: Array<{ c: Contact; score: number }> = []
  for (const c of contacts) {
    const email = c.email.toLowerCase()
    const name = (c.name || '').toLowerCase()
    const s = Math.max(fieldScore(email, q), fieldScore(name, q))
    if (s > 0) scored.push({ c, score: s + Math.min(c.n, 50) / 1000 })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.c)
}

// 0 = no match. Higher = better. Prefix > substring > subsequence.
function fieldScore(target: string, q: string): number {
  if (!target) return 0
  if (target.startsWith(q)) return 100
  const idx = target.indexOf(q)
  if (idx >= 0) return 60 - Math.min(idx, 30)
  return isSubsequence(q, target) ? 20 : 0
}

function isSubsequence(q: string, target: string): boolean {
  let i = 0
  for (let j = 0; j < target.length && i < q.length; j++) {
    if (target[j] === q[i]) i++
  }
  return i === q.length
}
