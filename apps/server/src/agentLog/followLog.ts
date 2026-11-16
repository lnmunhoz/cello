// Following one log file as a stream of updates (CEL-106): what's there first, then each batch of new
// steps as lines are appended, read when the watcher says the file changed (no timers). Before every
// read the path is checked again, so a transcript swapped for a symlink later is refused then too.
// Nothing is kept once the stream ends: the parser and tail live only as long as someone has the log open.
import * as fs from "node:fs"
import * as path from "node:path"
import type { LogStep, LogUpdate } from "@cello/contract/agentLog"
import { MAX_FIRST_STEPS } from "@cello/contract/agentLog"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import { type FileTail, fileTail } from "./FileTail.ts"
import { redactStep, transcriptParser } from "./transcript.ts"
import type { Guarded } from "./transcriptPath.ts"

/** Calls `onChange` when `file` may have changed (written, created, removed); returns how to stop. */
export type Watch = (file: string, onChange: () => void) => () => void

/**
 * The real watcher: the file's folder (so a file not written yet, or replaced, is still seen), or while
 * that folder doesn't exist the nearest one above it that does, moving down as folders appear.
 */
export const watchFile: Watch = (file, onChange) => {
  let watcher: fs.FSWatcher | null = null
  let closed = false
  const setup = () => {
    watcher?.close()
    watcher = null
    let dir = path.dirname(file)
    while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir)
    const direct = dir === path.dirname(file)
    try {
      watcher = fs.watch(dir, (_event, name) => {
        if (closed) return
        if (!direct) {
          setup()
          onChange()
        } else if (name == null || String(name) === path.basename(file)) onChange()
      })
      // A folder removed under it: the next read says missing; nothing to throw.
      watcher.on("error", () => {})
    } catch {
      watcher = null
    }
  }
  setup()
  return () => {
    closed = true
    watcher?.close()
  }
}

export interface FollowOptions {
  /** The path as reported; watched even before it exists. */
  readonly file: string
  /** Whether it may be read now, and the real file to read (transcriptPath.ts's guard, or the runs folder's). */
  readonly check: () => Guarded
  /** Send keys and tokens as they are: only for the human, who asked to see them. */
  readonly reveal: boolean
  readonly watch: Watch
}

/** The steps in order of first sight, each in its latest version. */
const latest = (steps: ReadonlyArray<LogStep>): ReadonlyArray<LogStep> => {
  // A Map keeps a key where it was first set, so a step updated later keeps its place.
  const byId = new Map<string, LogStep>()
  for (const step of steps) byId.set(step.id, step)
  return [...byId.values()]
}

export const followLog = (options: FollowOptions): Stream.Stream<LogUpdate> =>
  Stream.callback<LogUpdate>((queue) =>
    Effect.gen(function* () {
      let tail: FileTail | null = null
      let tailFile = ""
      let parser = transcriptParser()
      let missingSent = false
      let ended = false

      const missing = () => {
        tail = null
        if (!missingSent) Queue.offerUnsafe(queue, { _tag: "unavailable", reason: "missing" })
        missingSent = true
      }

      const pump = () => {
        if (ended) return
        const guarded = options.check()
        if (guarded._tag === "refused") {
          ended = true
          Queue.offerUnsafe(queue, { _tag: "unavailable", reason: "refused" })
          Queue.endUnsafe(queue)
          return
        }
        if (guarded._tag === "missing") return missing()
        if (tail === null || tailFile !== guarded.file) {
          tail = fileTail(guarded.file)
          tailFile = guarded.file
        }
        const read = tail.read()
        if (read._tag === "missing") return missing()
        missingSent = false
        if (read.reset) parser = transcriptParser()
        const steps = latest(read.lines.flatMap((line) => parser.push(line))).map((step) => redactStep(step, options.reveal))
        if (read.reset) {
          const skipped = Math.max(0, steps.length - MAX_FIRST_STEPS)
          Queue.offerUnsafe(queue, { _tag: "steps", steps: steps.slice(skipped), reset: true, skipped })
        } else if (steps.length > 0) Queue.offerUnsafe(queue, { _tag: "steps", steps, reset: false, skipped: 0 })
      }

      // Watching starts before the first read, so nothing written in between is missed.
      const stop = options.watch(options.file, pump)
      yield* Effect.addFinalizer(() => Effect.sync(stop))
      pump()
    }))
