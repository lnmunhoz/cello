// What an agent is doing besides its last tool call, kept pure (CEL-133). A subagent can end its turn
// while background work it started is still running (a Docker e2e run with run_in_background, a Monitor
// watching it): Claude Code fires SubagentStop, then resumes the agent when that work ends. So each
// piece of background work an agent starts is remembered (from PostToolUse: Bash's `backgroundTaskId`,
// Monitor's `taskId`), and a stop compares it with the session's `background_tasks`: while some of its
// own work runs, the agent is waiting on it, not finished.
import type { TestProgress, TestRun } from "@cello/contract/entities"
import { testRunLabel } from "@cello/shared/testRun"

/** One piece of background work an agent started: Claude Code's task id, and the call in one line. */
export interface BackgroundWork {
  readonly id: string
  readonly label: string
  readonly toolUseId: string | null
}

/** How many pieces of background work are remembered per agent: the newest. */
export const MAX_BACKGROUND = 20

/** `list` with `work` added (replacing one with its id), newest last, the newest MAX_BACKGROUND kept. */
export const withBackground = (list: ReadonlyArray<BackgroundWork>, work: BackgroundWork): ReadonlyArray<BackgroundWork> =>
  [...list.filter((w) => w.id !== work.id), work].slice(-MAX_BACKGROUND)

export interface StopOutcome {
  /** No work of its own is left running: the agent is done. */
  readonly finished: boolean
  /** Its work still running, which is all that's worth remembering after a stop. */
  readonly background: ReadonlyArray<BackgroundWork>
  /** What it waits on, one line each; null when it isn't waiting. */
  readonly waitingOn: ReadonlyArray<string> | null
}

const FINISHED: StopOutcome = { finished: true, background: [], waitingOn: null }

/**
 * What a stop means for an agent that started `background`, given the ids the session still runs
 * (SubagentStop's `background_tasks`, which lists the whole session's: the parent's and other agents'
 * too). Unknown (`undefined`, an older Claude Code) finishes it, as stops always did.
 */
export const stopOutcome = (background: ReadonlyArray<BackgroundWork>, running: ReadonlyArray<string> | undefined): StopOutcome => {
  if (running === undefined) return FINISHED
  const live = new Set(running)
  const own = background.filter((w) => live.has(w.id))
  return own.length === 0 ? FINISHED : { finished: false, background: own, waitingOn: own.map((w) => w.label) }
}

const isWork = (value: unknown): value is BackgroundWork => {
  if (value === null || typeof value !== "object") return false
  const w = value as Record<string, unknown>
  return typeof w.id === "string" && typeof w.label === "string" && (w.toolUseId === null || typeof w.toolUseId === "string")
}

/** JSON that may be missing or broken: null for either. */
const parsed = (json: string | null | undefined): unknown => {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/** The stored `background_json`; anything it can't read is none. */
export const parseBackground = (json: string | null | undefined): ReadonlyArray<BackgroundWork> => {
  const value = parsed(json)
  return Array.isArray(value) ? value.filter(isWork) : []
}

/** The stored `waiting_json` as the entity's `waitingOn`; anything it can't read, or an empty list, is null. */
export const parseWaiting = (json: string | null | undefined): ReadonlyArray<string> | null => {
  const value = parsed(json)
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string") ? value : null
}

/** A list as stored: JSON, or null for an empty or missing one. */
export const stored = (list: ReadonlyArray<unknown> | null): string | null => (list === null || list.length === 0 ? null : JSON.stringify(list))

// ── test runs (CEL-134) ─────────────────────────────────────────────────────────────────────────
// A tool call that runs a test command starts a run (PreToolUse). In the foreground it ends with that
// call (PostToolUse: passed; PostToolUseFailure: failed); run in the background it takes the task's id
// and runs on until the runner's last report, or a stop whose `background_tasks` no longer lists it. The
// runner's reports (`cello test progress`) fill in where it is.

/** A run as stored: the contract's TestRun, plus what finds it again (the call's or task's id) and the folder it runs in. */
export interface StoredTestRun extends TestRun {
  readonly runId: string
  readonly cwd: string | null
}

/** A new run, from the tool call about to run `command`. */
export const testsStarted = (input: { readonly runId: string; readonly command: string; readonly cwd: string | null; readonly now: number }): StoredTestRun => ({
  runId: input.runId,
  cwd: input.cwd,
  label: testRunLabel(input.command),
  command: input.command,
  startedAt: input.now,
  endedAt: null,
  outcome: null,
  background: false,
  progress: null,
})

const end = (run: StoredTestRun, outcome: NonNullable<TestRun["outcome"]>, now: number): StoredTestRun => ({ ...run, endedAt: now, outcome })

/** The call ran it in the background (its response named task `backgroundId`): the run is found by that id now. */
export const testsBackgrounded = (run: StoredTestRun, toolUseId: string | null, backgroundId: string): StoredTestRun =>
  run.endedAt === null && !run.background && run.runId === toolUseId ? { ...run, runId: backgroundId, background: true } : run

/** A call ended: a foreground run started by it is over, passed or failed with it. */
export const testsToolFinished = (run: StoredTestRun, toolUseId: string, failed: boolean, now: number): StoredTestRun =>
  run.endedAt === null && !run.background && run.runId === toolUseId ? end(run, failed ? "failed" : "passed", now) : run

/**
 * The turn ended (a Stop or SubagentStop), with the ids of the background work still running (unknown:
 * `undefined`). A foreground run can't outlive its turn; a background run ends once it's no longer listed.
 */
export const testsTurnEnded = (run: StoredTestRun, running: ReadonlyArray<string> | undefined, now: number): StoredTestRun => {
  if (run.endedAt !== null) return run
  if (run.background && (running === undefined || running.includes(run.runId))) return run
  return end(run, "ended", now)
}

const OUTCOMES = { passed: "passed", failed: "failed", stopped: "ended" } as const

/** The runner's report: where it is; its last one (`done`) ends the run with its outcome. An ended run takes no more. */
export const testsProgressed = (run: StoredTestRun, progress: TestProgress, now: number): StoredTestRun => {
  if (run.endedAt !== null) return run
  const next = { ...run, progress }
  return progress.done ? end(next, OUTCOMES[progress.outcome ?? "stopped"], now) : next
}

/** The run as boards see it: without the id and folder it's found by. */
export const publicRun = ({ runId: _runId, cwd: _cwd, ...run }: StoredTestRun): TestRun => run

/** The stored `tests_json`; anything it can't read is none. */
export const parseTests = (json: string | null | undefined): StoredTestRun | null => {
  const value = parsed(json)
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null
  const run = value as Record<string, unknown>
  return typeof run.runId === "string" && typeof run.label === "string" && typeof run.command === "string" && typeof run.startedAt === "number"
    ? (value as StoredTestRun)
    : null
}

/** The stored `tests_json` as the entity's `tests`. */
export const testsOf = (json: string | null | undefined): TestRun | null => {
  const run = parseTests(json)
  return run === null ? null : publicRun(run)
}

/** Whether two folders are one inside the other (the runner may run from the repo root, the call from below it, or the other way). */
export const sameFolder = (a: string | null, b: string | null): boolean => {
  if (a === null || b === null) return false
  const inside = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`)
  return inside(a, b) || inside(b, a)
}
