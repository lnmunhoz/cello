// Bare web addresses in plain text (comments, descriptions, review steps) as links. Only http(s).
// As in GitHub's autolinks: punctuation that ends a sentence stays text, and a closing bracket stays
// text unless the address opened it ("(see https://x.dev/a_(b))" links "https://x.dev/a_(b)").

export type TextPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "link"; readonly text: string; readonly url: string }

const ADDRESS = /\bhttps?:\/\/[^\s<>"'`]+/gi
const TRAILING = new Set([".", ",", ":", ";", "!", "?", "*", "_", "~"])
const OPENER: Record<string, string> = { ")": "(", "]": "[", "}": "{" }

const count = (text: string, char: string) => text.split(char).length - 1

const trim = (raw: string): string => {
  let url = raw
  for (;;) {
    const last = url.at(-1) ?? ""
    const opener = OPENER[last]
    if (TRAILING.has(last) || (opener !== undefined && count(url, last) > count(url, opener))) url = url.slice(0, -1)
    else return url
  }
}

const isWebAddress = (url: string) => {
  const parsed = URL.parse(url)
  return parsed !== null && parsed.hostname !== "" && /[a-z0-9]/i.test(parsed.hostname)
}

/** `text` split into plain text and links, in order. Text without an address comes back as one piece. */
export const linkify = (text: string): TextPart[] => {
  const parts: TextPart[] = []
  let done = 0
  for (const match of text.matchAll(ADDRESS)) {
    const url = trim(match[0])
    if (!isWebAddress(url)) continue
    if (match.index > done) parts.push({ type: "text", text: text.slice(done, match.index) })
    parts.push({ type: "link", text: url, url })
    done = match.index + url.length
  }
  if (done < text.length) parts.push({ type: "text", text: text.slice(done) })
  return parts
}

/** "https://github.com/lnmunhoz/cello/pull/12/" → "github.com/lnmunhoz/cello/pull/12" */
export const shortUrl = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/$/, "")
