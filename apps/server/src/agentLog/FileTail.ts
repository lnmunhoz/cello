// Reading a file that keeps growing, a line at a time (CEL-106): Claude Code appends to a transcript as
// the agent works. Each `read` hands over the complete lines written since the last one; a line without
// its newline yet (and a character split between writes) waits for the next read. A file that shrinks
// was replaced, and one that disappears is missing: either way the next lines come from its start,
// marked `reset`, so whoever shows them starts over.
import * as fs from "node:fs"

export type TailRead =
  | { readonly _tag: "lines"; readonly lines: ReadonlyArray<string>; readonly reset: boolean }
  | { readonly _tag: "missing" }

export interface FileTail {
  readonly read: () => TailRead
}

const NEWLINE = 0x0a

/** A tail of `file` from byte `from` (0: the whole file). */
export const fileTail = (file: string, from = 0): FileTail => {
  let offset = from
  let pending: Buffer = Buffer.alloc(0)
  /** The next lines start the log over: the first read, and after the file was missing or replaced. */
  let fresh = true

  const startOver = () => {
    offset = 0
    pending = Buffer.alloc(0)
    fresh = true
  }

  return {
    read: () => {
      let size: number
      try {
        size = fs.statSync(file).size
      } catch {
        startOver()
        return { _tag: "missing" }
      }
      // Shorter than what was read: replaced.
      if (size < offset) startOver()
      const reset = fresh
      fresh = false
      if (size <= offset) return { _tag: "lines", lines: [], reset }
      const chunk = Buffer.alloc(size - offset)
      const fd = fs.openSync(file, "r")
      let read = 0
      try {
        read = fs.readSync(fd, chunk, 0, chunk.length, offset)
      } finally {
        fs.closeSync(fd)
      }
      offset += read
      const bytes = Buffer.concat([pending, chunk.subarray(0, read)])
      const end = bytes.lastIndexOf(NEWLINE)
      if (end === -1) {
        pending = bytes
        return { _tag: "lines", lines: [], reset }
      }
      pending = Buffer.from(bytes.subarray(end + 1))
      return { _tag: "lines", lines: bytes.subarray(0, end).toString("utf8").split("\n"), reset }
    },
  }
}
