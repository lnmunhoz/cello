// The side panel's text view (CEL-60): how a text file on the board shows. Markdown through the page
// reader; JSON indented; everything else (terminal transcripts, test logs, CSV, casts) in monospace,
// wrapped, without the ANSI codes a terminal recording carries. Pure, so the rules are tested here.

/**
 * ANSI escape sequences: CSI (colours, cursor moves, line clears: ESC [ … letter), OSC (window titles,
 * links: ESC ] … BEL or ESC \), and the two-character ones (ESC followed by one character).
 */
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

/** `text` without its ANSI escape codes. */
export const stripAnsi = (text: string): string => text.replace(ANSI, "")

export type TextFormat = "markdown" | "json" | "plain"

const typeOf = (mime: string | null) => (mime ?? "").split(";")[0]!.trim().toLowerCase()

/** How a file shows, by its served type, else its name. */
export const textFormat = (mime: string | null, name: string | undefined): TextFormat => {
  const type = typeOf(mime)
  const ext = name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (type === "text/markdown" || ext === "md") return "markdown"
  if (type === "application/json" || ext === "json") return "json"
  return "plain"
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

/** The name Download saves a file under: its own, else the last part of its address. */
export const downloadName = (url: string, name: string | undefined): string =>
  name?.trim() || decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "file")
