// Masking strings that look like keys and tokens (CEL-106), before an agent's log or current step
// leaves the server. An agent's transcript holds whatever it saw: command output, file contents, now and
// then a secret from a `.env`. Each one keeps its first four characters, so the human can tell which key
// it was, and the rest becomes dots. It errs towards masking: a masked commit message costs a click on
// "Show secrets"; a key shown in a screenshot costs a key.

/** What stands in for the hidden part. */
export const MASK = "••••••••"

/** Keys with a known shape. */
const KNOWN = [
  /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}/g, // OpenAI, Anthropic, Stripe-style secret keys
  /\b(?:rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g, // Stripe restricted and publishable keys
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS access key ids
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}/g, // Google API keys
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWTs
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
]

/** `NAME=value` or `NAME: value` where an environment-style name (capitals) says it's a secret: the value goes, whatever it looks like. Lower-case names are left alone: code (`const token = …`) is full of them. */
const NAMED = /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)(["']?\s*[:=]\s*)("[^"\n]{4,}"|'[^'\n]{4,}'|[^\s"'`]{4,})/g

/** A long run of key-like characters (no `/`, so paths survive). Masked only when it looks random. */
const LONG = /[A-Za-z0-9+_=-]{40,}/g

/** Upper, lower and digits all in it, and not only hex (commit hashes, sha256 sums): random enough to be a secret. */
const looksRandom = (s: string) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s) && !/^[0-9a-fA-F-]+$/.test(s)

const mask = (secret: string) => `${secret.slice(0, 4)}${MASK}`

export interface Redacted {
  readonly text: string
  /** Something was hidden: the screen offers to show it. */
  readonly masked: boolean
}

/** `text` with anything that looks like a key or token masked. */
export const redact = (text: string): Redacted => {
  let masked = false
  let out = text
  for (const pattern of KNOWN) {
    out = out.replace(pattern, (found) => {
      masked = true
      return mask(found)
    })
  }
  out = out.replace(NAMED, (found, name: string, sep: string, value: string) => {
    if (value.includes(MASK)) return found
    masked = true
    const quote = /^["']/.test(value) ? value[0]! : ""
    return `${name}${sep}${quote}${mask(value.slice(quote.length, quote ? -1 : undefined))}${quote}`
  })
  out = out.replace(LONG, (found) => {
    if (!looksRandom(found) || found.includes(MASK)) return found
    masked = true
    return mask(found)
  })
  return { text: out, masked }
}
