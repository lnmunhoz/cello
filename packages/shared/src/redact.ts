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
  // JWTs. Not right after a base64url character (`\b` would be): else every `-eyJ` in a long run is a start, and it's quadratic.
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
]

/**
 * How many name characters may come before and after the word that says it's secret. Real names fit
 * (`aws_secret_access_key`, `GITHUB_PERSONAL_ACCESS_TOKEN`); unbounded, a pattern backtracks across one
 * long word (`tokentoken…`) and takes seconds.
 */
const AROUND = "{0,40}"

/** A name that says its value is a secret, in any case. */
const SECRET_NAME = String.raw`[A-Za-z0-9_]${AROUND}(?:secret|token|password|passwd|api_?key|private_?key|access_?key)[A-Za-z0-9_]${AROUND}`

/** An unquoted literal, not code: 8 or more of these characters, and not followed by `(` or `[` (a call, an index). */
const LITERAL = String.raw`[A-Za-z0-9_+/=.-]{8,}(?![A-Za-z0-9_+/=.(\[-])`

/** Letters and digits both: `hunter2hunter2` is a password; `getToken`, `string` and `12345678` (a count) aren't. */
const mixed = (value: string) => /[0-9]/.test(value) && /[A-Za-z]/.test(value)

/** How far back a command's name may be from its flag: `curl -s -H "…" -u user:pass` fits, a `\`-continued line too. */
const COMMAND_REACH = 300

/** Where one command ends: a newline that doesn't continue the line, `&&`, `||`. (Not `;` or `&`: a header or a URL holds those.) */
const COMMAND_END = /(?<!\\)\n|&&|\|\|/

/**
 * The command's name is shortly before the match, in the same command, so `-u`/`-p` carry a password
 * here, unlike `docker run -u 1000:1000` or `curl … && ssh -p2222`.
 */
const after =
  (command: RegExp) =>
  (_value: string, text: string, offset: number): boolean =>
    command.test(text.slice(Math.max(0, offset - COMMAND_REACH), offset).split(COMMAND_END).at(-1)!)

interface After {
  /** Its `value` group is masked, the `pre` group kept. */
  readonly pattern: RegExp
  /** Mask only when this holds; otherwise the match stays as it was. */
  readonly when?: (value: string, text: string, offset: number) => boolean
}

/**
 * Values that follow something saying they're secret: each pattern's `value` group is masked, the rest
 * kept. Lower-case names count only in shapes code rarely has (`name=value` with no spaces, a quoted
 * value, an ini line, an unquoted value of letters and digits), so `const token = getToken()` and
 * `passwordField: string` are left alone.
 *
 * Each pattern stays linear on any line (CodeQL checks for ReDoS). A pattern can start at many places in
 * one long word, so a repeat that could run on to the next start is bounded (the name, `AROUND`; a URL's
 * scheme) or stops at a character the start needs (a cookie's name stops at `:`). A check that would need
 * a looser pattern (letters and digits both, which command it is) runs on the match, in `when`.
 */
const AFTER: ReadonlyArray<After> = [
  // NAME=value, NAME: value, with an environment-style name (capitals): whatever the value looks like.
  {
    pattern: new RegExp(
      String.raw`\b(?<pre>[A-Z0-9_]${AROUND}(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]${AROUND}["']?\s*[:=]\s*)(?<value>"[^"\n]{4,}"|'[^'\n]{4,}'|[^\s"'\`]{4,})`,
      "g",
    ),
  },
  // any name, quoted value: "api_key": "…", password: '…'
  { pattern: new RegExp(String.raw`\b(?<pre>${SECRET_NAME}["']?\s*[:=]\s*)(?<value>"[^"\n]{4,}"|'[^'\n]{4,}')`, "gi") },
  // any name, name=value with no spaces: password=hunter2
  { pattern: new RegExp(String.raw`\b(?<pre>${SECRET_NAME}=)(?<value>[^\s"'\`&;|]{4,})`, "gi") },
  // an ini or TOML line: aws_secret_access_key = …
  { pattern: new RegExp(String.raw`^(?<pre>[ \t]*${SECRET_NAME}[ \t]*=[ \t]*)(?<value>[^\s"'\`]{4,})[ \t]*$`, "gim") },
  // any name, an unquoted value of letters and digits: password: hunter2hunter2 (YAML), token = …, apikey …
  {
    pattern: new RegExp(String.raw`\b(?<pre>${SECRET_NAME}["']?(?:[ \t]*[:=][ \t]*|[ \t]+))(?<value>${LITERAL})`, "gi"),
    when: mixed,
  },
  // Authorization: Bearer …
  { pattern: /\b(?<pre>Bearer\s+)(?<value>[A-Za-z0-9._~+/=-]{12,})/gi },
  // Authorization: Basic …, Authorization: token …
  { pattern: /\b(?<pre>authorization["']?[ \t]*:[ \t]*["']?(?:basic|token)[ \t]+)(?<value>[A-Za-z0-9._~+/=-]{4,})/gi },
  // a header that names a key: X-Api-Key: …, Private-Token: … (a quoted object key, "x-api-key": apiKey, is code)
  { pattern: /\b(?<pre>(?:x-)?(?:api-?key|(?:auth|access|private)-token)[ \t]*:[ \t]*)(?<value>[^\s"'`,;]{4,})/gi },
  // Cookie: session=…, Set-Cookie: sid=…: all of it, the cookies' names too
  { pattern: /\b(?<pre>(?:set-)?cookie["']?[ \t]*:[ \t]*["']?)(?<value>[^\s"'`;=,:]+=[^\r\n"'`]*)/gi },
  // a password in a URL: scheme://user:password@host
  { pattern: /\b(?<pre>[a-z][a-z0-9+.-]{0,30}:\/\/[^\s:/@]+:)(?<value>[^\s@/]{3,})(?=@)/gi },
  // --password=…, --token …
  {
    pattern: new RegExp(
      String.raw`(?<pre>--[a-z0-9-]${AROUND}(?:password|passwd|token|secret|api-?key)[a-z0-9-]${AROUND}(?:=|\s+))(?<value>[^\s"'\`-][^\s"'\`]{3,})`,
      "gi",
    ),
  },
  // curl -u user:password, curl --user user:password
  {
    pattern: /(?<pre>(?:^|[ \t])(?:-u[ \t]*|--user(?:[ \t]+|=))["']?[^\s:"'@]+:)(?<value>[^\s"'@]+)/gm,
    when: after(/\bcurl\b/),
  },
  // mysql -ppassword: the password attached (`-p` alone asks for it)
  {
    pattern: /(?<pre>(?:^|[ \t])-p)(?<value>"[^"\n]+"|'[^'\n]+'|[^\s"'`;|&]+)/gm,
    when: after(/\b(?:mysql|mariadb)/),
  },
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
  for (const { pattern, when } of AFTER) {
    out = out.replace(pattern, (found: string, ...args: unknown[]) => {
      // With named groups, a replacer's last three arguments are the match's offset, the whole text and the groups.
      const { pre, value } = args.at(-1) as { pre: string; value: string }
      if (value.includes(MASK)) return found
      if (when && !when(value, args.at(-2) as string, args.at(-3) as number)) return found
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
