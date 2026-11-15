// Search text helpers shared by the server (SearchService, CEL-11/CEL-43), the ⌘K bar and the CLI:
// a query's words, where words start with them, FTS5 highlight markers turned into ranges, and long
// text clipped around its first match.

/** [start, end) offsets into a string: the words a query matched. */
export type Range = readonly [number, number]

/** Text with the ranges of it that matched. */
export interface Marked {
  readonly text: string
  readonly ranges: ReadonlyArray<Range>
}

/** What SearchService asks FTS5's highlight() and snippet() to put around a match. */
export const MARK_OPEN = "\u0001"
export const MARK_CLOSE = "\u0002"

const WORD = /[\p{L}\p{N}]+/gu

/** The query's words, lower-cased. Each matches the start of a word; all of them must match. */
export const searchTerms = (query: string): string[] => (query.toLowerCase().match(WORD) ?? []).filter((t) => t.length > 0)

/** Where each term starts a word in `text`, merged and in order. */
export const wordPrefixRanges = (text: string, terms: ReadonlyArray<string>): Range[] => {
  if (terms.length === 0) return []
  const lower = text.toLowerCase()
  const found: Array<[number, number]> = []
  for (const m of lower.matchAll(WORD)) {
    for (const term of terms) {
      if (m[0].startsWith(term)) found.push([m.index, m.index + term.length])
    }
  }
  found.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const merged: Array<[number, number]> = []
  for (const r of found) {
    const last = merged.at(-1)
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/** Whether every term starts a word in at least one of `texts`. No terms matches everything. */
export const matchesAll = (texts: ReadonlyArray<string>, terms: ReadonlyArray<string>): boolean =>
  terms.every((term) => texts.some((text) => wordPrefixRanges(text, [term]).length > 0))

/** FTS5 highlight()/snippet() output with MARK_OPEN/MARK_CLOSE around matches, as plain text and ranges. */
export const fromMarked = (marked: string): Marked => {
  let text = ""
  const ranges: Array<[number, number]> = []
  let open: number | null = null
  for (const char of marked) {
    if (char === MARK_OPEN) open = text.length
    else if (char === MARK_CLOSE) {
      if (open !== null && text.length > open) ranges.push([open, text.length])
      open = null
    } else text += char
  }
  if (open !== null && text.length > open) ranges.push([open, text.length])
  return { text, ranges }
}

/**
 * About `max` characters of `marked` around its first match, cut at word edges, with an ellipsis where
 * it was cut; the ranges move with it, and those cut off are dropped. Without a match: the start.
 */
export const clipAround = (marked: Marked, max: number): Marked => {
  const { text, ranges } = marked
  if (text.length <= max) return marked
  const first = ranges[0]
  let start = first ? Math.max(0, first[0] - Math.floor(max / 4)) : 0
  if (start > 0) {
    const space = text.indexOf(" ", start)
    if (space !== -1 && first && space < first[0]) start = space + 1
  }
  let end = Math.min(text.length, start + max)
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end)
    if (space > start && (!first || space >= first[1])) end = space
  }
  const head = start > 0 ? "…" : ""
  const shift = head.length - start
  return {
    text: `${head}${text.slice(start, end)}${end < text.length ? "…" : ""}`,
    ranges: ranges.filter(([s, e]) => s >= start && e <= end).map(([s, e]) => [s + shift, e + shift] as const),
  }
}

/** Splits `text` into plain and matched pieces, for drawing <mark> or [brackets]. */
export const segments = (text: string, ranges: ReadonlyArray<Range>): Array<{ text: string; match: boolean }> => {
  const out: Array<{ text: string; match: boolean }> = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start > at) out.push({ text: text.slice(at, start), match: false })
    if (end > start) out.push({ text: text.slice(Math.max(start, at), end), match: true })
    at = Math.max(at, end)
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false })
  return out
}
