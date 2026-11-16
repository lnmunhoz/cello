// Where a Docker test run is (CEL-134), read from the container's output as it streams: the stage
// (`== web-e2e`, printed by the container script before each step), Playwright's total ("Running 13
// tests using 1 worker") and its list reporter's line per test ("✓   7 e2e/board.spec.ts:40:1 › title
// (2.1s)", ✘ for a failure, - for a skip), and Vitest's line per file. The runner writes it to
// progress.json in the run folder as it changes, and hands it to the board with `cello test progress`.
// Its shape is the contract's TestProgress.

/** The progress file's name in the run folder. */
export const PROGRESS_FILE = "progress.json"

/** How many failures are kept: the newest. */
const MAX_FAILURES = 20

export interface RunProgress {
  readonly stage: string | null
  readonly passed: number
  readonly failed: number
  readonly skipped: number
  readonly total: number | null
  /** The spec file the last test ended in. */
  readonly current: string | null
  /** Each failure as it happened: "e2e/board.spec.ts:40 › drags a card". */
  readonly failures: ReadonlyArray<string>
  readonly done: boolean
  readonly outcome: "passed" | "failed" | "stopped" | null
  readonly folder: string | null
}

export const startProgress = (folder: string): RunProgress => ({
  stage: null, passed: 0, failed: 0, skipped: 0, total: null, current: null, failures: [], done: false, outcome: null, folder,
})

const STAGE = /^== (\S+)\s*$/
const TOTAL = /^Running (\d+) tests? using/
/** Playwright's list reporter: mark, number, optional `[project] › `, `file:line:col › title`, optional `(time)`. */
const TEST = /^\s*(✓|✘|-|ok|x)\s+\d+\s+(?:\[[^\]]+\]\s+›\s+)?(\S+?):(\d+):\d+\s+›\s+(.*?)(?:\s+\([\d.]+m?s\))?\s*$/
/** Vitest: `✓ file (N tests) 12ms`, `❯ file (N tests | F failed) 40ms`. */
const VITEST = /^\s*(✓|❯|×)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s+\((\d+) tests?(?:\s*\|\s*(\d+) failed)?/

const withFailure = (state: RunProgress, failure: string): ReadonlyArray<string> => [...state.failures, failure].slice(-MAX_FAILURES)

/** The progress after one line of output. */
export const feed = (state: RunProgress, line: string): RunProgress => {
  const stage = STAGE.exec(line)
  if (stage) return { ...state, stage: stage[1]!, passed: 0, failed: 0, skipped: 0, total: null, current: null }
  const total = TOTAL.exec(line)
  if (total) return { ...state, total: Number(total[1]) }
  const test = TEST.exec(line)
  if (test) {
    const [, mark, file, at, title] = test as unknown as [string, string, string, string, string]
    if (mark === "✓" || mark === "ok") return { ...state, passed: state.passed + 1, current: file }
    if (mark === "-") return { ...state, skipped: state.skipped + 1, current: file }
    return { ...state, failed: state.failed + 1, current: file, failures: withFailure(state, `${file}:${at} › ${title}`) }
  }
  const vitest = VITEST.exec(line)
  if (vitest) {
    const [, , file, tests, failed] = vitest as unknown as [string, string, string, string, string | undefined]
    const bad = Number(failed ?? 0)
    return {
      ...state,
      passed: state.passed + Number(tests) - bad,
      failed: state.failed + bad,
      current: file,
      failures: bad > 0 ? withFailure(state, file) : state.failures,
    }
  }
  return state
}

/** The last progress: done, and how it ended. */
export const finish = (state: RunProgress, end: { readonly exit: number | null; readonly signalled: boolean }): RunProgress => ({
  ...state,
  done: true,
  outcome: end.signalled ? "stopped" : end.exit === 0 ? "passed" : "failed",
})

/**
 * Splits a stream into lines: `push` takes a chunk and returns the lines it completed, `end` the last
 * one if the stream didn't end with a newline.
 */
export const lineSplitter = () => {
  let rest = ""
  return {
    push: (chunk: string): string[] => {
      const parts = (rest + chunk).split(/\r?\n/)
      rest = parts.pop() ?? ""
      return parts
    },
    end: (): string[] => (rest === "" ? [] : [rest]),
  }
}
