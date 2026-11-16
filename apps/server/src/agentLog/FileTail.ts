// Reading a file that keeps growing, a line at a time (CEL-106): Claude Code appends to a transcript as
// the agent works. Each `read` hands over the complete lines written since the last one; a line without
// its newline yet (and a character split between writes) waits for the next read. A file that shrinks
// was replaced, and one that disappears is missing: either way the next lines come from its start,
// marked `reset`, so whoever shows them starts over.
//
// Reads are bounded, so a transcript of hundreds of megabytes never stalls the server: a fresh read
// starts `window` bytes before the end (at the first whole line there, `older` saying earlier lines
// exist), later reads take at most `chunk` bytes (`more` saying there's more to read), and a single line
// longer than `maxLine` is dropped rather than held.
import * as fs from "node:fs"

export type TailRead =
  | {
    readonly _tag: "lines"
    readonly lines: ReadonlyArray<string>
    readonly reset: boolean
    /** More was written than this read took: read again. */
    readonly more: boolean
    /** A fresh read that started past the file's beginning. */
    readonly older: boolean
  }
  | { readonly _tag: "missing" }
  /** The file is there but can't be read (permissions, a folder…). */
  | { readonly _tag: "unreadable" }

export interface FileTail {
  readonly read: () => TailRead
}

/** The file system calls it makes (tests replace them to fail in between). */
export interface TailIo {
  readonly statSync: (file: string) => { readonly size: number }
  readonly openSync: (file: string, flags: "r") => number
  readonly readSync: (fd: number, buffer: Buffer, offset: number, length: number, position: number) => number
  readonly closeSync: (fd: number) => void
}

export interface TailOptions {
  /** A fresh read takes at most this many bytes from the end. */
  readonly window?: number
  /** A later read takes at most this many bytes. */
  readonly chunk?: number
  /** A line longer than this is dropped. */
  readonly maxLine?: number
  readonly io?: TailIo
}

export const TAIL_WINDOW = 4 * 1024 * 1024
export const TAIL_CHUNK = 2 * 1024 * 1024
export const MAX_LINE = 8 * 1024 * 1024

const NEWLINE = 0x0a

const codeOf = (error: unknown) => (typeof error === "object" && error !== null && "code" in error ? String(error.code) : "")

export const fileTail = (file: string, options: TailOptions = {}): FileTail => {
  const window = options.window ?? TAIL_WINDOW
  const chunk = options.chunk ?? TAIL_CHUNK
  const maxLine = options.maxLine ?? MAX_LINE
  const io = options.io ?? fs
  let offset = 0
  let pending: Buffer = Buffer.alloc(0)
  /** Throwing bytes away until the next newline: the start of a line too long, or cut off by the window. */
  let skipping = false
  /** The next lines start the log over: the first read, and after the file was missing or replaced. */
  let fresh = true

  const startOver = () => {
    offset = 0
    pending = Buffer.alloc(0)
    skipping = false
    fresh = true
  }

  const readAt = (position: number, length: number): Buffer => {
    const buffer = Buffer.alloc(length)
    const fd = io.openSync(file, "r")
    try {
      return buffer.subarray(0, io.readSync(fd, buffer, 0, length, position))
    } finally {
      io.closeSync(fd)
    }
  }

  return {
    read: () => {
      try {
        const { size } = io.statSync(file)
        // Shorter than what was read: replaced.
        if (size < offset) startOver()
        const reset = fresh
        let older = false
        if (fresh && size > window) {
          offset = size - window
          older = true
          // The window starts mid-line (unless the byte before it ends one): that line is dropped.
          skipping = readAt(offset - 1, 1)[0] !== NEWLINE
        }
        fresh = false
        const length = Math.min(size - offset, reset ? window : chunk)
        let bytes = length > 0 ? readAt(offset, length) : Buffer.alloc(0)
        offset += bytes.length
        const more = offset < size
        if (skipping) {
          const end = bytes.indexOf(NEWLINE)
          if (end === -1) return { _tag: "lines", lines: [], reset, more, older }
          bytes = bytes.subarray(end + 1)
          skipping = false
        }
        bytes = pending.length > 0 ? Buffer.concat([pending, bytes]) : bytes
        const end = bytes.lastIndexOf(NEWLINE)
        pending = Buffer.from(end === -1 ? bytes : bytes.subarray(end + 1))
        if (pending.length > maxLine) {
          pending = Buffer.alloc(0)
          skipping = true
        }
        const lines = end === -1 ? [] : bytes.subarray(0, end).toString("utf8").split("\n")
        return { _tag: "lines", lines, reset, more, older }
      } catch (error) {
        if (codeOf(error) === "ENOENT") {
          startOver()
          return { _tag: "missing" }
        }
        return { _tag: "unreadable" }
      }
    },
  }
}
