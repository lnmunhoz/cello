// The Docker runner's side of showing a test run on the board (CEL-134): it keeps progress.json in the
// run folder current as the output streams (./progress.ts reads it), and hands it to the board with
// `cello test progress --file …` when an agent session runs it (CLAUDE_CODE_SESSION_ID): at once for a
// new failure and at the end, else at most every REPORT_EVERY_MS. Fail-safe: no `cello`, no server or a
// slow one never touches the run; the reports are dropped, the tests run as before.
import * as fs from "node:fs"
import * as path from "node:path"
import { feed, finish, PROGRESS_FILE, type RunProgress, startProgress } from "./progress.ts"

/** The board hears a run's progress at most this often, unless a test failed or the run ended. */
export const REPORT_EVERY_MS = 3000

/** A `cello test progress` that runs longer than this is killed: a stuck one never holds reports up. */
export const REPORT_TIMEOUT_MS = 10_000

/**
 * Writes `text` to `file` whole or not at all: into a new temp file next to it (created exclusively, so
 * a link planted at that name is never followed), then renamed over it (which replaces a link at `file`
 * rather than writing through it). A reader never sees half a file.
 */
export const writeAtomically = (file: string, text: string): void => {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temp, text, { flag: "wx" })
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}

/** How long the runner waits for its last report before it exits anyway. */
export const LAST_REPORT_MS = 5000

export interface ReporterDeps {
  readonly now: () => number
  /** Writes the progress file; a failure is ignored. */
  readonly write: (file: string, text: string) => void
  /** Runs `cello test progress --file <file>`; resolves when it exits, however it ends. Null: nobody to report to. */
  readonly report: ((file: string) => Promise<void>) | null
  readonly schedule: (run: () => void, ms: number) => void
}

export const progressReporter = (folder: string, deps: ReporterDeps) => {
  const file = path.join(folder, PROGRESS_FILE)
  let state = startProgress(folder)
  let reportedAt: number | null = null
  let reportedFailed = 0
  let inFlight: Promise<void> | null = null
  let pending = false
  let scheduled = false

  const save = () => {
    try {
      deps.write(file, `${JSON.stringify(state, null, 2)}\n`)
    } catch {
      // No progress file, then; the run goes on.
    }
  }

  /** Reports now, or right after the report in flight. */
  const send = (): Promise<void> => {
    if (deps.report === null) return Promise.resolve()
    if (inFlight !== null) {
      pending = true
      return inFlight
    }
    reportedAt = deps.now()
    reportedFailed = state.failed
    inFlight = deps.report(file).catch(() => undefined).then(() => {
      inFlight = null
      if (pending) {
        pending = false
        return send()
      }
    })
    return inFlight
  }

  const maybeSend = () => {
    if (deps.report === null) return
    const due = reportedAt === null || state.failed !== reportedFailed || deps.now() - reportedAt >= REPORT_EVERY_MS
    if (due) return void send()
    if (scheduled) return
    scheduled = true
    deps.schedule(() => {
      scheduled = false
      void send()
    }, REPORT_EVERY_MS - (deps.now() - reportedAt!))
  }

  return {
    get progress(): RunProgress {
      return state
    },
    /** One line of the container's output. */
    line: (line: string) => {
      const next = feed(state, line)
      if (next === state) return
      state = next
      save()
      maybeSend()
    },
    /** The run ended: the last progress, written and reported (waited on, for at most LAST_REPORT_MS). */
    finish: (end: { readonly exit: number | null; readonly signalled: boolean }): Promise<void> => {
      state = finish(state, end)
      save()
      return Promise.race([send(), new Promise<void>((resolve) => deps.schedule(resolve, LAST_REPORT_MS))])
    },
  }
}
