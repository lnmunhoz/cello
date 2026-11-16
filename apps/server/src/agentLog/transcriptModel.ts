// Which model an agent is on (CEL-119), from its Claude Code transcript: every reply Claude Code writes
// carries the model that wrote it and the effort it ran at (Claude Code 2.x, Nov 2026):
//
//   { type: "assistant", effort: "high", perTurnEffort: "high", requestedModel: "claude-opus-5-5",
//     message: { model: "claude-opus-5-5", role: "assistant", content: […] }, … }
//
// A session's transcript holds the session's replies only; a subagent's (`<session>/subagents/agent-<id>.jsonl`)
// its own, so each says who it is. The newest reply wins, so a `/model` switch shows from the next reply on.
//
// Read on every request an agent makes (ModelService), so it's cheap: only the end of the file (bounded
// windows), again only once the file's size or time changed, and never a file the agentLog guard refuses.
import * as fs from "node:fs"
import { fileTail, type TailIo } from "./FileTail.ts"
import { guardLogFile } from "./transcriptPath.ts"

/** The model that wrote a reply, as Claude Code names it (`claude-opus-5-5`), and its effort (`high`), if it said. */
export interface WrittenBy {
  readonly model: string
  readonly effort: string | null
}

/** Model ids are short and plain: letters, digits and `-._:/@[]`. Anything else isn't kept. */
const MODEL = /^[A-Za-z0-9][\w.:/@[\]-]{0,99}$/

/** Efforts are one short word (low, medium, high, xhigh, max). */
const EFFORT = /^[a-z]{1,20}$/

/** Claude Code's own replies (an API error, an interrupted turn): written by no model. */
const SYNTHETIC = "<synthetic>"

const replyOf = (line: string): WrittenBy | null => {
  // Most lines aren't replies; skip them without parsing (tool results can be large).
  if (!line.includes('"assistant"')) return null
  let json: unknown
  try {
    json = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof json !== "object" || json === null) return null
  const { type, message, effort } = json as { type?: unknown; message?: unknown; effort?: unknown }
  if (type !== "assistant" || typeof message !== "object" || message === null) return null
  const model = (message as { model?: unknown }).model
  if (typeof model !== "string" || model === SYNTHETIC || !MODEL.test(model)) return null
  return { model, effort: typeof effort === "string" && EFFORT.test(effort) ? effort : null }
}

/** The newest reply's model and effort among transcript lines, oldest first; null before the first reply. */
export const lastModel = (lines: ReadonlyArray<string>): WrittenBy | null => {
  for (let i = lines.length - 1; i >= 0; i--) {
    const found = replyOf(lines[i]!)
    if (found) return found
  }
  return null
}

/**
 * How far back from the end it looks: the last 256 KB, and only when that holds no whole reply (a long
 * tool result after it), the last 2 MB. Past that, nothing: the value stays empty rather than slow a write.
 */
export const MODEL_WINDOWS: ReadonlyArray<number> = [256 * 1024, 2 * 1024 * 1024]

/** How many transcripts' answers it keeps; past that the oldest goes. */
const CACHED = 256

export interface ModelReaderOptions {
  /** Claude Code's projects folder: the only place transcripts are read from (transcriptPath.ts). */
  readonly projectsDir: string
  readonly windows?: ReadonlyArray<number> | undefined
  readonly io?: TailIo | undefined
}

/**
 * Reads the model of a transcript's newest reply: null for a path the guard refuses, a file that's gone
 * or unreadable, or one with no reply in its last window. Never throws.
 */
export const modelReader = (options: ModelReaderOptions): (reported: string) => WrittenBy | null => {
  const windows = options.windows ?? MODEL_WINDOWS
  const cache = new Map<string, { readonly size: number; readonly mtimeMs: number; readonly found: WrittenBy | null }>()
  return (reported) => {
    try {
      const guarded = guardLogFile(reported, options.projectsDir)
      if (guarded._tag !== "ok") return null
      const { size, mtimeMs } = fs.statSync(guarded.file)
      const cached = cache.get(guarded.file)
      if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.found
      let found: WrittenBy | null = null
      for (const window of windows) {
        const read = fileTail(guarded.file, { window, maxLine: window, ...(options.io ? { io: options.io } : {}) }).read()
        if (read._tag !== "lines") break
        found = lastModel(read.lines)
        if (found !== null || !read.older) break
      }
      cache.delete(guarded.file)
      if (cache.size >= CACHED) cache.delete(cache.keys().next().value!)
      cache.set(guarded.file, { size, mtimeMs, found })
      return found
    } catch {
      return null
    }
  }
}
