// What an agent is doing besides its last tool call, kept pure (CEL-133). A subagent can end its turn
// while background work it started is still running (a Docker e2e run with run_in_background, a Monitor
// watching it): Claude Code fires SubagentStop, then resumes the agent when that work ends. So each
// piece of background work an agent starts is remembered (from PostToolUse: Bash's `backgroundTaskId`,
// Monitor's `taskId`), and a stop compares it with the session's `background_tasks`: while some of its
// own work runs, the agent is waiting on it, not finished.
import { type TestProgress, TestRun } from "@cello/contract/entities"
import { stageFits, testRunLabel } from "@cello/domain/testRun"
import * as Schema from "effect/Schema"

/**
 * One piece of background work an agent started: Claude Code's task id, the call in one line, and
 * whether the agent waits for it (`waits`: a Monitor, or a test run). Only that work keeps a stopped
 * agent waiting: a dev server it left running in the background (`bun run dev`) never ends, so it
 * would never finish (review S3).
 */
export interface BackgroundWork {
  readonly id: string
  readonly label: string
  readonly toolUseId: string | null
  readonly waits: boolean
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
  const own = background.filter((w) => w.waits && live.has(w.id))
  return own.length === 0 ? FINISHED : { finished: false, background: own, waitingOn: own.map((w) => w.label) }
}

const isWork = Schema.is(Schema.Struct({ id: Schema.String, label: Schema.String, toolUseId: Schema.NullOr(Schema.String), waits: Schema.Boolean }))

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
export const StoredTestRun = Schema.Struct({ ...TestRun.fields, runId: Schema.String, cwd: Schema.NullOr(Schema.String) })
export type StoredTestRun = typeof StoredTestRun.Type
const isStoredRun = Schema.is(StoredTestRun)

/** How many runs an agent keeps: its live ones and the newest (review S2: a run never replaces a live one). */
export const MAX_RUNS = 4

/** A new run, from the tool call about to run `command`. */
export const testsStarted = (input: {
  readonly runId: string
  readonly command: string
  readonly cwd: string | null
  readonly now: number
  /** The task the server picked for it (CEL-181); left out or null: none. */
  readonly taskId?: string | null
}): StoredTestRun => ({
  runId: input.runId,
  cwd: input.cwd,
  label: testRunLabel(input.command),
  command: input.command,
  startedAt: input.now,
  endedAt: null,
  outcome: null,
  background: false,
  progress: null,
  ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
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

/**
 * The stored `tests_json`: an agent's runs. Only whole runs are kept: one that doesn't match the stored
 * shape (a missing field, a progress of the wrong type) is dropped, so a bad row can never reach
 * encoding, where it would fail every snapshot and event that carries the agent.
 */
export const parseRuns = (json: string | null | undefined): ReadonlyArray<StoredTestRun> => {
  const value = parsed(json)
  return Array.isArray(value) ? value.filter(isStoredRun) : []
}

/** The run folder a run took its first report from (CEL-147): its reports come from there, and only there. */
const boundFolder = (run: StoredTestRun): string | null => run.progress?.folder ?? null

/**
 * `runs` with a new one started, at most MAX_RUNS: live runs stay (a background Docker run goes on while a
 * unit run starts). Of the ended ones, the newest bound to a run folder stay in the room left, so a late
 * report from that folder still finds its run and never lands on the new one (CEL-147); the rest go.
 */
export const withRun = (runs: ReadonlyArray<StoredTestRun>, run: StoredTestRun): ReadonlyArray<StoredTestRun> => {
  const live = [...runs.filter((r) => r.endedAt === null), run].slice(-MAX_RUNS)
  const room = MAX_RUNS - live.length
  const remembered = room === 0 ? [] : runs.filter((r) => r.endedAt !== null && boundFolder(r) !== null).slice(-room)
  const kept = new Set([...remembered, ...live])
  return [...runs.filter((r) => kept.has(r)), run]
}

/** Every kept run as boards see it (CEL-181): what a task's thread shows live, each with its task. */
export const runsOf = (json: string | null | undefined): ReadonlyArray<TestRun> => parseRuns(json).map(publicRun)

/**
 * The runs a change ended (CEL-181): in `after`, ended, and open in `before` under the same run id. So an
 * unchanged list, a run that was already over (a late report, a second stop) and a run `withRun` dropped
 * from the list all give none, and each run is reported once. Match within one change only: a run that
 * takes a background id changes its `runId`, but never ends in the same step.
 */
export const endedNow = (before: ReadonlyArray<StoredTestRun>, after: ReadonlyArray<StoredTestRun>): ReadonlyArray<StoredTestRun> =>
  after.filter((run) => run.endedAt !== null && before.some((r) => r.runId === run.runId && r.endedAt === null))

/** The run boards show: the newest running one, else the one that ended last. */
export const shownRun = (runs: ReadonlyArray<StoredTestRun>): StoredTestRun | null => {
  const running = runs.filter((r) => r.endedAt === null).sort((a, b) => b.startedAt - a.startedAt)
  if (running[0]) return running[0]
  return [...runs].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0] ?? null
}

/** The stored `tests_json` as the entity's `tests`. */
export const testsOf = (json: string | null | undefined): TestRun | null => {
  const run = shownRun(parseRuns(json))
  return run === null ? null : publicRun(run)
}

const inside = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`)

/** Whether two folders are one inside the other (the runner may run from the repo root, the call from below it, or the other way). */
export const sameFolder = (a: string | null, b: string | null): boolean => a !== null && b !== null && (inside(a, b) || inside(b, a))

/**
 * Which of the session's runs a runner's report from `cwd` is for. A run ended or not taken (undefined)
 * takes nothing; the caller drops the report.
 *
 * 1. A run that took a report from the report's run folder (`folder`) takes it, ended or not (CEL-147):
 *    a late report from a finished run never lands on another.
 * 2. Else a running run that hasn't taken one from another folder: started from `cwd` or from a folder
 *    one inside the other (review S1: the orchestrator at the repo root and a builder in a worktree inside
 *    it), else the session's only such run. Of those, one started from `cwd` exactly, then the deepest
 *    folder, then one whose label fits the stage (stageFits: a `web-e2e` report is a "web e2e" run's).
 * 3. Still a tie: the oldest, as runners start reporting in the order they started. But while the stage
 *    fits runs of different kinds (both a web and a desktop Docker run are installing first), the report
 *    waits for one that tells them apart, unless it's the last.
 */
export const pickRun = <C extends { readonly run: StoredTestRun }>(candidates: ReadonlyArray<C>, cwd: string, progress: TestProgress): C | undefined => {
  const { folder, stage } = progress
  const bound = folder === null ? undefined : candidates.find((c) => boundFolder(c.run) === folder)
  if (bound !== undefined) return bound
  const open = candidates.filter((c) => c.run.endedAt === null && boundFolder(c.run) === null)
  const near = open.filter((c) => sameFolder(c.run.cwd, cwd))
  const pool = near.length > 0 ? near : open.length === 1 ? open : []
  const rank = (c: C) => [Number(c.run.cwd === cwd), c.run.cwd?.length ?? 0, Number(stageFits(stage, c.run.label))] as const
  const better = (a: C, b: C) => {
    const [x, y] = [rank(a), rank(b)]
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]
  }
  const ranked = [...pool].sort((a, b) => better(a, b) || a.run.startedAt - b.run.startedAt)
  const first = ranked[0]
  if (first === undefined) return undefined
  const tied = ranked.filter((c) => better(c, first) === 0)
  const kinds = new Set(tied.map((c) => c.run.label))
  return kinds.size > 1 && stageFits(stage, first.run.label) && !progress.done ? undefined : first
}
