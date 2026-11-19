// The side panel's text view (CEL-60): how a text file on the board shows. Markdown through the page
// reader; JSON indented; everything else (terminal transcripts, test logs, CSV, casts) in monospace,
// wrapped, without the ANSI codes a terminal recording carries; a unified diff (CEL-173) as a diff view.
// Pure, so the rules are tested here.
import { parseUnifiedDiff, type ParsedDiff } from "@cello/text/diff"

/**
 * ANSI escape sequences: CSI (colours, cursor moves, line clears: ESC [ … letter), OSC (window titles,
 * links: ESC ] … BEL or ESC \), and the two-character ones (ESC followed by one character).
 */
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

/** `text` without its ANSI escape codes. */
export const stripAnsi = (text: string): string => text.replace(ANSI, "")

export type TextFormat = "markdown" | "json" | "diff" | "plain"

const typeOf = (mime: string | null) => (mime ?? "").split(";")[0]!.trim().toLowerCase()

/** How a file shows, by its served type, else its name. */
export const textFormat = (mime: string | null, name: string | undefined): TextFormat => {
  const type = typeOf(mime)
  const ext = name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (type === "text/markdown" || ext === "md") return "markdown"
  if (type === "application/json" || ext === "json") return "json"
  if (type === "text/x-diff" || type === "text/x-patch" || ext === "diff" || ext === "patch") return "diff"
  return "plain"
}

/**
 * The diff view's model, when the text is a unified diff: a `.diff`/`.patch` file, or a `.txt` or
 * `.log` (the plain format) whose content parses as one, so an agent's `git diff > x.txt` opens as a
 * diff. Colour codes (`git diff --color`) are stripped first. Null when there's no file in it.
 */
export const asDiff = (format: TextFormat, text: string): ParsedDiff | null => {
  if (format !== "diff" && format !== "plain") return null
  const parsed = parseUnifiedDiff(stripAnsi(text))
  return parsed.files.length > 0 ? parsed : null
}

/** What the monospace view shows: JSON indented when it parses, anything else without its ANSI codes. */
export const shownText = (text: string, format: Exclude<TextFormat, "markdown">): string => {
  if (format === "json") {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }
  return stripAnsi(text)
}

/** How much of a file the text view shows: stored files go up to 50 MB, more than a page should hold. Download has all of it. */
export const MAX_SHOWN_BYTES = 1024 * 1024
/** MAX_SHOWN_BYTES in words, for the note over a clipped file. */
export const MAX_SHOWN_LABEL = "1 MB"

/**
 * Reads `body` as UTF-8 text, at most `max` bytes, and stops reading (cancels the stream) once it has
 * them. Clipped, the text ends at the last whole line inside the limit (or the last whole character,
 * for a file without line breaks there).
 */
export const readShown = async (body: ReadableStream<Uint8Array>, max = MAX_SHOWN_BYTES): Promise<{ text: string; clipped: boolean }> => {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  let clipped = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (bytes + value.byteLength > max) {
      chunks.push(value.subarray(0, max - bytes))
      clipped = true
      await reader.cancel()
      break
    }
    chunks.push(value)
    bytes += value.byteLength
  }
  const joined = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  chunks.reduce((at, c) => (joined.set(c, at), at + c.byteLength), 0)
  // `stream: true` holds back a character cut in half at the end instead of turning it into U+FFFD.
  const text = new TextDecoder().decode(joined, { stream: clipped })
  if (!clipped) return { text, clipped }
  const lastLine = text.lastIndexOf("\n")
  return { text: lastLine === -1 ? text : text.slice(0, lastLine + 1), clipped }
}

/** The name Download saves a file under: its own, else the last part of its address. */
export const downloadName = (url: string, name: string | undefined): string =>
  name?.trim() || decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "file")
