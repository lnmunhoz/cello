// Bare web addresses and task keys in plain text (comments, descriptions, review steps, pages) as
// links. Only http(s) addresses.
//
// Addresses, as in GitHub's autolinks: punctuation that ends a sentence stays text, and a closing
// bracket stays text unless the address opened it ("(see https://x.dev/a_(b))" links "https://x.dev/a_(b)").
//
// Task keys (`CEL-12`): uppercase only, standing on their own ("CEL-8," and "(CEL-3)" link; "XCEL-3",
// "CEL-3a" and "CEL-3.5" don't), outside code spans and fenced code blocks, and only those the caller
// knows exist (`isTask`). A key inside an address stays part of the address.

import { eachLine } from "./document.ts"
import { parseTaskKey } from "./taskKey.ts"

export type TextPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "link"; readonly text: string; readonly url: string }
  | { readonly type: "task"; readonly text: string; readonly key: string; readonly projectKey: string; readonly number: number }

export interface LinkifyOptions {
  /**
   * Whether to link this key ("CEL-12"). Without it, task keys stay text. A caller may answer for the
   * project only and check the task when it renders the link (the web app does, so its parse doesn't
   * change whenever a task does).
   */
  readonly isTask?: ((key: string) => boolean) | undefined
}

const ADDRESS = /\bhttps?:\/\/[^\s<>"'`]+/gi
const TRAILING = new Set([".", ",", ":", ";", "!", "?", "*", "_", "~"])
const OPENER: Record<string, string> = { ")": "(", "]": "[", "}": "{" }

/** Not after a letter, digit, `_` or `-`; not before one, nor before `-`/`.` and one (`CEL-3-fix`, `CEL-3.md`). */
const TASK_KEY = /(?<![\w-])[A-Z][A-Z0-9]{1,9}-[1-9][0-9]*(?!\w|[-.]\w)/g
/** An inline code span: a run of backticks, up to the next run of the same length. */
const CODE_SPAN = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g

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

type Range = readonly [start: number, end: number]

const inside = (ranges: ReadonlyArray<Range>, index: number) => ranges.some(([start, end]) => index >= start && index < end)

/** Where the code is: the lines of fenced blocks (document.ts's fence rule), then inline spans outside them. */
const codeRanges = (text: string): Range[] => {
  const ranges: Range[] = []
  let offset = 0
  eachLine(text.split("\n"), (line, _index, inCode) => {
    if (inCode) ranges.push([offset, offset + line.length + 1])
    offset += line.length + 1
  })
  for (const span of text.matchAll(CODE_SPAN)) if (!inside(ranges, span.index)) ranges.push([span.index, span.index + span[0].length])
  return ranges
}

interface Found {
  readonly start: number
  readonly part: Exclude<TextPart, { type: "text" }>
}

const addresses = (text: string): Found[] =>
  [...text.matchAll(ADDRESS)].flatMap((match) => {
    const url = trim(match[0])
    return isWebAddress(url) ? [{ start: match.index, part: { type: "link", text: url, url } }] : []
  })

const taskKeys = (text: string, isTask: (key: string) => boolean, taken: ReadonlyArray<Range>): Found[] => {
  const code = codeRanges(text)
  return [...text.matchAll(TASK_KEY)].flatMap((match) => {
    const ref = parseTaskKey(match[0])
    if (!ref || inside(taken, match.index) || inside(code, match.index) || !isTask(match[0])) return []
    return [{ start: match.index, part: { type: "task", text: match[0], key: match[0], ...ref } }]
  })
}

/** `text` split into plain text, links and task keys, in order. Text with none comes back as one piece. */
export const linkify = (text: string, options: LinkifyOptions = {}): TextPart[] => {
  const links = addresses(text)
  const found = options.isTask ? [...links, ...taskKeys(text, options.isTask, links.map((l) => [l.start, l.start + l.part.text.length] as const))] : links
  const parts: TextPart[] = []
  let done = 0
  for (const { start, part } of found.sort((a, b) => a.start - b.start)) {
    if (start > done) parts.push({ type: "text", text: text.slice(done, start) })
    parts.push(part)
    done = start + part.text.length
  }
  if (done < text.length) parts.push({ type: "text", text: text.slice(done) })
  return parts
}

/** "https://github.com/lnmunhoz/cello/pull/12/" → "github.com/lnmunhoz/cello/pull/12" */
export const shortUrl = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/$/, "")
