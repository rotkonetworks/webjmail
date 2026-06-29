// JMAP server autodiscovery from an email address. Most users know their email,
// not their "JMAP server URL", so we derive candidate endpoints from the domain
// and let the auth path (which goes through Rust on desktop / direct in the
// browser) try each. Mirrors how Thunderbird/Apple Mail autoconfigure.

export function emailDomain(email: string): string | null {
  const at = email.indexOf('@')
  if (at < 1 || at === email.length - 1) return null
  return email.slice(at + 1).trim().toLowerCase() || null
}

// Standard places a JMAP `.well-known/jmap` session endpoint tends to live.
// Ordered most- to least-likely; the first that authenticates wins.
export function candidateServers(email: string): string[] {
  const d = emailDomain(email)
  if (!d) return []
  return [
    `https://${d}/.well-known/jmap`,
    `https://mail.${d}/.well-known/jmap`,
    `https://jmap.${d}/.well-known/jmap`,
  ]
}

// Best single guess to pre-fill the manual form when discovery fails.
export function bestGuessServer(email: string): string {
  const d = emailDomain(email)
  return d ? `https://mail.${d}/.well-known/jmap` : ''
}

export function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}
