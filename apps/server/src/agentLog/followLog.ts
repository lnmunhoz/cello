// Following one log file as a stream of updates (CEL-106): what's there first, then each batch of new
// steps as lines are appended, read when the watcher says the file changed, and at a coarse re-check
// for the changes it never reports (CEL-126, below). Each pass reads up to the file's current size, so
// how many events arrived doesn't matter. Before every read the path is checked again, so a transcript
// swapped for a symlink later is refused then too.
// Reads are bounded (FileTail): a long transcript is read from near its end, a big append in chunks with
// a yield between them, so one huge file never stalls the server. Nothing is kept once the stream ends:
// the parser and tail live only as long as someone has the log open.
import * as fs from "node:fs"
import * as path from "node:path"
import type { LogStep, LogUpdate } from "@cello/contract/agentLog"
import { MAX_FIRST_STEPS } from "@cello/contract/agentLog"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import { type FileTail, fileTail } from "./FileTail.ts"
import { redactStep, transcriptParser } from "./transcript.ts"
import type { Guarded } from "./transcriptPath.ts"

/**
 * How often the file is looked at although the watcher said nothing (CEL-126). fs.watch can't be
 * trusted to report every write: on macOS under load, Bun's watcher is armed some time after
 * `fs.watch` returns, and a write in that gap raises no event (a probe at load ~160 missed 41 of 100
 * writes made right after the watch started, 3 of 100 made 50 ms after). There's no signal for "armed",
 * so reading once after setting it up can't close the gap. Without this, the last step stayed unshown
 * until the agent wrote again; with it, a write the watcher misses shows up within about a second. A quiet re-check is one guard check and one stat, and sends nothing; it
 * runs only while someone has the log open.
 */
export const FOLLOW_RECHECK = Duration.seconds(1)

/** Calls `onChange` when `file` may have changed (written, created, removed); returns how to stop. */
export type Watch = (file: string, onChange: () => void) => () => void

/**
 * The real watcher: the file's folder (so a file not written yet, or replaced, is still seen), or while
 * that folder doesn't exist the nearest one above it that does, moving down as the folders on the way
 * appear (other changes in that folder are ignored).
 */
export const watchFile: Watch = (file, onChange) => {
  let watcher: fs.FSWatcher | null = null
  let closed = false
  const setup = () => {
    watcher?.close()
    watcher = null
    const target = path.dirname(file)
    let dir = target
    while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir)
    // Watching the file's folder: its own name matters; watching one above: the next folder on the way.
    const wanted = dir === target ? path.basename(file) : path.relative(dir, target).split(path.sep)[0]
    try {
      watcher = fs.watch(dir, (_event, name) => {
        if (closed || (name != null && String(name) !== wanted)) return
        if (dir !== target) setup()
        onChange()
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
  /** How a file is read (tests replace it); FileTail by default. */
  readonly open?: ((file: string) => FileTail) | undefined
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
      const open = options.open ?? fileTail
      let tail: FileTail | null = null
      let tailFile = ""
      let parser = transcriptParser()
      let missingSent = false
      let ended = false

      const end = (reason: "refused" | "unreadable") => {
        ended = true
        Queue.offerUnsafe(queue, { _tag: "unavailable", reason })
        Queue.endUnsafe(queue)
      }

      const missing = () => {
        tail = null
        if (!missingSent) Queue.offerUnsafe(queue, { _tag: "unavailable", reason: "missing" })
        missingSent = true
      }

      /** One bounded read; whether there's more to read now. */
      const pumpOnce = (): boolean => {
        const guarded = options.check()
        if (guarded._tag === "refused") return (end("refused"), false)
        if (guarded._tag === "missing") return (missing(), false)
        if (tail === null || tailFile !== guarded.file) {
          tail = open(guarded.file)
          tailFile = guarded.file
        }
        const read = tail.read()
        if (read._tag === "unreadable") return (end("unreadable"), false)
        if (read._tag === "missing") return (missing(), false)
        missingSent = false
        if (read.reset) parser = transcriptParser()
        const steps = latest(read.lines.flatMap((line) => parser.push(line)))
        // Only what's sent is masked: the first batch keeps its newest steps first.
        if (read.reset) {
          const skipped = Math.max(0, steps.length - MAX_FIRST_STEPS)
          Queue.offerUnsafe(queue, {
            _tag: "steps",
            steps: steps.slice(skipped).map((step) => redactStep(step, options.reveal)),
            reset: true,
            skipped,
            ...(read.older ? { older: true } : {}),
          })
        } else if (steps.length > 0) {
          Queue.offerUnsafe(queue, { _tag: "steps", steps: steps.map((step) => redactStep(step, options.reveal)), reset: false, skipped: 0 })
        }
        return read.more
      }

      /** Reads until caught up, a chunk at a time with a yield between, so other work goes on. */
      const catchUp = Effect.gen(function* () {
        let more = true
        while (more && !ended) {
          try {
            more = pumpOnce()
          } catch {
            end("unreadable")
          }
          yield* Effect.yieldNow
        }
      })

      // The watcher and the re-check only mark the file as changed: one read loop runs at a time, and
      // changes during it fold into one more pass.
      const changed = yield* Queue.sliding<void>(1)
      // Watching starts before the first read, though the watcher may not be armed yet (FOLLOW_RECHECK).
      const stop = options.watch(options.file, () => void Queue.offerUnsafe(changed, undefined))
      yield* Effect.addFinalizer(() => Effect.sync(stop))
      yield* catchUp
      yield* Effect.forkScoped(Effect.gen(function* () {
        while (!ended) {
          yield* Queue.take(changed)
          yield* catchUp
        }
      }))
      yield* Effect.forkScoped(Effect.forever(Effect.sleep(FOLLOW_RECHECK).pipe(Effect.andThen(Queue.offer(changed, undefined)))))
    }))
