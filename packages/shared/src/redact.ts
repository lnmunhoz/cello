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

/** A name that says its value is a secret, in any case. */
const SECRET_NAME = String.raw`[A-Za-z0-9_]*(?:secret|token|password|passwd|api_?key|private_?key|access_?key)[A-Za-z0-9_]*`

/**
 * Values that follow something saying they're secret: each pattern's `value` group is masked, the rest
 * kept. Lower-case names count only in shapes code rarely has (`name=value` with no spaces, a quoted
 * value, an ini line), so `const token = getToken()` and `passwordField: string` are left alone.
 */
const AFTER = [
  // NAME=value, NAME: value, with an environment-style name (capitals): whatever the value looks like.
  /\b(?<pre>[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*["']?\s*[:=]\s*)(?<value>"[^"\n]{4,}"|'[^'\n]{4,}'|[^\s"'`]{4,})/g,
  // any name, quoted value: "api_key": "…", password: '…'
  new RegExp(String.raw`\b(?<pre>${SECRET_NAME}["']?\s*[:=]\s*)(?<value>"[^"\n]{4,}"|'[^'\n]{4,}')`, "gi"),
  // any name, name=value with no spaces: password=hunter2
  new RegExp(String.raw`\b(?<pre>${SECRET_NAME}=)(?<value>[^\s"'\`&;|]{4,})`, "gi"),
  // an ini or TOML line: aws_secret_access_key = …
  new RegExp(String.raw`^(?<pre>[ \t]*${SECRET_NAME}[ \t]*=[ \t]*)(?<value>[^\s"'\`]{4,})[ \t]*$`, "gim"),
  // Authorization: Bearer …
  /\b(?<pre>Bearer\s+)(?<value>[A-Za-z0-9._~+/=-]{12,})/gi,
  // a password in a URL: scheme://user:password@host
  /\b(?<pre>[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)(?<value>[^\s@/]{3,})(?=@)/gi,
  // --password=…, --token …
  /(?<pre>--[a-z0-9-]*(?:password|passwd|token|secret|api-?key)[a-z0-9-]*(?:=|\s+))(?<value>[^\s"'`-][^\s"'`]{3,})/gi,
]

/** A long hex run: a key, unless it's as long as a sha256 or sha512 digest (64, 128) or shorter than 48 (commit hashes). */
const HEX = /\b[0-9a-fA-F]{48,}\b/g

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
  for (const pattern of AFTER) {
    out = out.replace(pattern, (found: string, ...args: unknown[]) => {
      const { pre, value } = args.at(-1) as { pre: string; value: string }
      if (value.includes(MASK)) return found
      masked = true
      // All of it: the start of a password is still part of the password. The name before it says what it was.
      const quote = /^["']/.test(value) ? value[0]! : ""
      return `${pre}${quote}${MASK}${quote}`
    })
  }
  out = out.replace(HEX, (found) => {
    if (found.length === 64 || found.length === 128) return found
    masked = true
    return mask(found)
  })
  out = out.replace(LONG, (found) => {
    if (!looksRandom(found) || found.includes(MASK)) return found
    masked = true
    return mask(found)
  })
  return { text: out, masked }
}
