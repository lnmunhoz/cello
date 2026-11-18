// A task's thread in time order (CEL-160): its comments as cards, and between them one line for each thing
// that happened: a stage, a move to another status, a subagent starting or finishing (with a reviewer's
// verdict), the merge, the release that took it live. Pure: the web app draws what this returns, the same
// on the task panel and the Review page.
//
// Lines come from the task's history (stage changes, status moves, and how each test run ended, CEL-181),
// `task.timeline` (the runs of every subagent on it, and the builds that name it), and presence (the test
// runs going right now, and ones that just ended, until the history has them). Left out on purpose: label,
// milestone and title edits, claims, comments and reactions (History keeps them).
//
// Test runs (CEL-181): a finished run is a `tests` line, a running one a `tests_live` line, with the same id
// (`testRunKey`) so one turns into the other in place. Both sit where the run started, so the line stays
// under the comment that announced it. Finished runs of one kind with only test lines between them collapse
// into the last ("unit tests passed · 6 runs"), and a fold keeps its test lines showing.
import type { BuildRecord } from "@cello/contract/build"
import { type AgentSession, agentKey, type ReviewVerdictSeen, type SessionAgent, type TestRun } from "@cello/contract/entities"
import { type CelloEvent, isReadable, type StreamedEvent } from "@cello/contract/events"
import { stageInfo, type TaskStage } from "@cello/contract/stages"
import type { AgentRun, TaskTimeline } from "@cello/contract/views"
import { modelLabel } from "@cello/shared/model"
import { isRunning, testRunKey, testRunWords } from "@cello/shared/testRun"
import { runLength } from "@cello/contract/wake"

/** Who did what a history line says: the actor, its session, and the subagent when it was one (CEL-55). */
export interface LineDoer {
  readonly actorId: string
  readonly sessionId: string | null
  readonly agentId: string | null
}

interface LineBase {
  /** Stable across refreshes: the key a list item and its fold state use. */
  readonly id: string
  readonly ts: number
}

export type TimelineLine =
  | (LineBase & { readonly kind: "stage"; readonly stage: TaskStage; readonly doer: LineDoer })
  | (LineBase & { readonly kind: "merge"; readonly doer: LineDoer })
  | (LineBase & { readonly kind: "status"; readonly from: string; readonly to: string; readonly doer: LineDoer })
  | (LineBase & {
    readonly kind: "run_start"
    readonly agentType: string | null
    readonly sessionId: string
    readonly agentId: string
    /** "Sonnet 5.5, medium": the agent's latest model and effort, when known. */
    readonly model: string | null
    /** Its second run or later: it was resumed. */
    readonly resumed: boolean
    /** It hasn't finished: the line says it's working. */
    readonly running: boolean
  })
  | (LineBase & {
    readonly kind: "run_end"
    readonly agentType: string | null
    readonly sessionId: string
    readonly agentId: string
    readonly model: string | null
    readonly durationMs: number
    /** A reviewer's verdict, when it left one. */
    readonly verdict: ReviewVerdictSeen | null
  })
  | (LineBase & { readonly kind: "release"; readonly build: BuildRecord })
  | TestsLine
  | TestsLiveLine

/** What of a finished run a collapsed line remembers about each one it absorbed. */
export interface EarlierRun {
  readonly outcome: "passed" | "failed" | "ended"
  readonly endedAt: number
  readonly words: string
  readonly failures: ReadonlyArray<string>
}

/**
 * A test run that ended (CEL-181). `ts` is when it started, which is where it sits; `endedAt` the time it
 * shows. `words` is the run in words ("web e2e passed · e2e/pages.spec.ts · 3 of 3 · 1m44s"). `runs` is how
 * many of one kind collapsed into it (1 when none did), `earlier` the ones before it.
 */
export type TestsLine = LineBase & {
  readonly kind: "tests"
  readonly doer: LineDoer
  readonly label: string
  readonly outcome: "passed" | "failed" | "ended"
  readonly words: string
  readonly endedAt: number
  readonly failures: ReadonlyArray<string>
  readonly command: string
  /** The run's results folder (summary.txt, logs, videos), when the runner reported one. */
  readonly folder: string | null
  readonly runs: number
  readonly earlier: ReadonlyArray<EarlierRun>
}

/** A test run going right now (CEL-181); it turns into the `tests` line with the same id when it ends. */
export type TestsLiveLine = LineBase & {
  readonly kind: "tests_live"
  readonly doer: LineDoer
  readonly label: string
  /** The running run in words ("web e2e · e2e/pages.spec.ts · 7 of 13 · 1 failed · 3m12s"), without "Running". */
  readonly words: string
  readonly failed: number
  readonly failures: ReadonlyArray<string>
  readonly command: string
}

export type TimelineLineKind = TimelineLine["kind"]

/** The names a line needs: statuses by id. */
export interface TimelineNames {
  readonly statuses: Readonly<Record<string, { readonly name: string }>>
}

export interface TimelineInput<C extends { readonly id: string; readonly createdAt: number }> {
  readonly comments: ReadonlyArray<C>
  readonly history: ReadonlyArray<StreamedEvent>
  readonly timeline: TaskTimeline
  readonly statuses: TimelineNames["statuses"]
  /** Test run lines from presence (`liveTestLines`, CEL-181): the runs going now, and ones ended but not in the history yet. */
  readonly live?: ReadonlyArray<TimelineLine>
}

export type TimelineItem<C> =
  | { readonly kind: "comment"; readonly id: string; readonly ts: number; readonly comment: C }
  | { readonly kind: "line"; readonly id: string; readonly ts: number; readonly line: TimelineLine }

/**
 * A run of lines folded into one row: `lines` is all of them in order, `newest` the last. Closed, the fold
 * shows `visible`: its test lines (finished and live: a result never folds away, CEL-181) and its newest line,
 * in order; the rest, `lines.length - visible.length` of them, are what the button counts.
 */
export interface TimelineFold {
  readonly kind: "fold"
  readonly id: string
  readonly lines: ReadonlyArray<TimelineLine>
  readonly newest: TimelineLine
  readonly visible: ReadonlyArray<TimelineLine>
}

export type ThreadItem<C> = TimelineItem<C> | TimelineFold

const doerOf = (e: CelloEvent): LineDoer => ({ actorId: e.actorId, sessionId: e.sessionId ?? null, agentId: e.agentId ?? null })

const outcomeOf = (run: TestRun): "passed" | "failed" | "ended" => run.outcome ?? "ended"

/**
 * A finished run as a line (CEL-181), the one builder for the history's `tests.finished` and for presence's
 * ended run not in the history yet, so the two read the same and the swap changes nothing on screen. Its id
 * is the run's key; `ts` is its start, `endedAt` the time shown.
 */
const testsLineOf = (doer: LineDoer, run: TestRun): TestsLine => {
  const endedAt = run.endedAt ?? run.startedAt
  return {
    kind: "tests",
    id: testRunKey(doer.sessionId ?? "-", doer.agentId, run.startedAt),
    ts: run.startedAt,
    endedAt,
    doer,
    label: run.label,
    outcome: outcomeOf(run),
    words: testRunWords(run, endedAt, { targets: true }),
    failures: run.progress?.failures ?? [],
    command: run.command,
    folder: run.progress?.folder ?? null,
    runs: 1,
    earlier: [],
  }
}

/** A running run as a line, with the same id the finished line will have. */
const liveLineOf = (doer: LineDoer, run: TestRun, now: number): TestsLiveLine => ({
  kind: "tests_live",
  id: testRunKey(doer.sessionId ?? "-", doer.agentId, run.startedAt),
  ts: run.startedAt,
  doer,
  label: run.label,
  words: testRunWords(run, now, { targets: true }),
  failed: run.progress?.failed ?? 0,
  failures: run.progress?.failures ?? [],
  command: run.command,
})

const historyLine = (e: StreamedEvent, statuses: TimelineNames["statuses"]): TimelineLine | null => {
  if (!isReadable(e)) return null
  if (e.type === "tests.finished") return testsLineOf(doerOf(e), e.run)
  if (e.type === "task.stage_changed") {
    if (e.after === null) return null
    const base = { id: `stage:${e.seq}`, ts: e.ts, doer: doerOf(e) }
    return e.after === "merged" ? { ...base, kind: "merge" } : { ...base, kind: "stage", stage: e.after }
  }
  if (e.type === "task.moved" && e.from.statusId !== e.to.statusId) {
    return {
      kind: "status",
      id: `status:${e.seq}`,
      ts: e.ts,
      from: statuses[e.from.statusId]?.name ?? "another status",
      to: statuses[e.to.statusId]?.name ?? "another status",
      doer: doerOf(e),
    }
  }
  return null
}

const runLines = (runs: ReadonlyArray<AgentRun>): ReadonlyArray<TimelineLine> => {
  const seen = new Map<string, number>()
  return [...runs].sort((a, b) => a.startedAt - b.startedAt).flatMap((run): TimelineLine[] => {
    const key = `${run.sessionId}/${run.agentId}`
    const index = seen.get(key) ?? 0
    seen.set(key, index + 1)
    const id = `run:${key}:${run.startedAt}`
    const model = modelLabel(run.model, run.effort)
    const head: TimelineLine = {
      kind: "run_start", id: `${id}:start`, ts: run.startedAt, agentType: run.agentType, sessionId: run.sessionId, agentId: run.agentId,
      model, resumed: index > 0, running: run.endedAt === null,
    }
    if (run.endedAt === null) return [head]
    return [head, {
      kind: "run_end", id: `${id}:end`, ts: run.endedAt, agentType: run.agentType, sessionId: run.sessionId, agentId: run.agentId,
      model, durationMs: run.endedAt - run.startedAt, verdict: run.verdict,
    }]
  })
}

type LineItem<C> = Extract<TimelineItem<C>, { kind: "line" }>

const isTestLine = (line: TimelineLine): line is TestsLine | TestsLiveLine => line.kind === "tests" || line.kind === "tests_live"

/**
 * Collapses finished runs of one kind into the last (CEL-181): within a stretch of test lines with nothing
 * else between them (no comment, stage, status move, agent start or finish, merge or release), the `tests`
 * lines of one label become the last of them, which counts them (`runs`) and remembers each earlier one's
 * outcome (`earlier`). Live lines are test lines too, but never collapse and never absorb a finished one.
 */
const collapseTests = <C>(items: ReadonlyArray<TimelineItem<C>>): ReadonlyArray<TimelineItem<C>> => {
  const out: Array<TimelineItem<C>> = []
  let stretch: Array<LineItem<C>> = []
  const flush = () => {
    const byLabel = new Map<string, Array<LineItem<C> & { line: TestsLine }>>()
    for (const item of stretch) if (item.line.kind === "tests") byLabel.set(item.line.label, [...(byLabel.get(item.line.label) ?? []), item as LineItem<C> & { line: TestsLine }])
    for (const item of stretch) {
      if (item.line.kind !== "tests") {
        out.push(item)
        continue
      }
      const group = byLabel.get(item.line.label)!
      if (group.at(-1) !== item) continue
      const earlier = group.slice(0, -1).map(({ line }): EarlierRun => ({ outcome: line.outcome, endedAt: line.endedAt, words: line.words, failures: line.failures }))
      // Absorbing runs a run itself absorbed already keeps their record.
      const before = group.flatMap(({ line }) => line.earlier)
      out.push(group.length === 1 ? item : { ...item, line: { ...item.line, runs: group.reduce((n, { line }) => n + line.runs, 0), earlier: [...before, ...earlier] } })
    }
    stretch = []
  }
  for (const item of items) {
    if (item.kind === "line" && isTestLine(item.line)) stretch.push(item)
    else {
      flush()
      out.push(item)
    }
  }
  flush()
  return out
}

/**
 * The thread in time order: `comments` and one line for each stage, status move, subagent start and finish,
 * merge and release, and test run (finished ones collapsed by kind, running ones from `live`). Equal times
 * keep this order: comments, history, runs, releases, live test runs.
 */
export const timelineOf = <C extends { readonly id: string; readonly createdAt: number }>(input: TimelineInput<C>): ReadonlyArray<TimelineItem<C>> => {
  const items: Array<TimelineItem<C>> = [
    ...input.comments.map((comment): TimelineItem<C> => ({ kind: "comment", id: comment.id, ts: comment.createdAt, comment })),
    ...input.history.flatMap((e): Array<TimelineItem<C>> => {
      const line = historyLine(e, input.statuses)
      return line ? [{ kind: "line", id: line.id, ts: line.ts, line }] : []
    }),
    ...runLines(input.timeline.runs).map((line): TimelineItem<C> => ({ kind: "line", id: line.id, ts: line.ts, line })),
    ...input.timeline.releases.map((build): TimelineItem<C> => {
      const line: TimelineLine = { kind: "release", id: `release:${build.id}`, ts: build.startedAt, build }
      return { kind: "line", id: line.id, ts: line.ts, line }
    }),
    ...(input.live ?? []).map((line): TimelineItem<C> => ({ kind: "line", id: line.id, ts: line.ts, line })),
  ]
  // Array.prototype.sort is stable, so equal times keep the order above.
  return collapseTests(items.sort((a, b) => a.ts - b.ts))
}

/** The keys of the test runs a task's history already has (CEL-181): what `liveTestLines` leaves to it. */
export const testKeysOf = (history: ReadonlyArray<StreamedEvent>): ReadonlySet<string> =>
  new Set(history.flatMap((e) => (isReadable(e) && e.type === "tests.finished" ? [testRunKey(e.sessionId ?? "-", e.agentId ?? null, e.run.startedAt)] : [])))

/** What `liveTestLines` reads of presence: the board's sessions and agents, with the runs each keeps. */
export interface LiveTestInput {
  readonly taskId: string
  readonly sessions: Readonly<Record<string, Pick<AgentSession, "id" | "actorId" | "endedAt" | "runs">>>
  readonly agents: Readonly<Record<string, Pick<SessionAgent, "sessionId" | "agentId" | "endedAt" | "runs">>>
  /** The keys the history has (`testKeysOf`): history wins, so a run in it is never added again. */
  readonly known: ReadonlySet<string>
  readonly now: number
}

/**
 * The test run lines presence gives for one task (CEL-181), for the thread's `live` input. Each run its
 * agents keep that names this task (`run.taskId`, picked by the server when it started):
 * 1. whose key the history has already: nothing (history wins);
 * 2. running, and its agent and session haven't ended, and it isn't older than STALE_RUN_MS: a live line;
 * 3. ended, but not in the history yet (the history is fetched again when `tests.finished` arrives, a moment
 *    after the board hears it end): the finished line the history will give, same id and words, so the row
 *    doesn't vanish and come back;
 * 4. else nothing.
 */
export const liveTestLines = (input: LiveTestInput): ReadonlyArray<TimelineLine> => {
  const lines: TimelineLine[] = []
  const take = (sessionId: string, agentId: string | null, runs: ReadonlyArray<TestRun> | undefined) => {
    const session = input.sessions[sessionId]
    // Only the session's actor is known to the board; without it the run has no one to credit.
    if (session === undefined) return
    const doer: LineDoer = { actorId: session.actorId, sessionId, agentId }
    for (const run of runs ?? []) {
      if (run.taskId !== input.taskId || input.known.has(testRunKey(sessionId, agentId, run.startedAt))) continue
      if (run.endedAt !== null) lines.push(testsLineOf(doer, run))
      else if (isRunning(run, input.now) && session.endedAt === null && (agentId === null || input.agents[agentKey(sessionId, agentId)]?.endedAt === null)) {
        lines.push(liveLineOf(doer, run, input.now))
      }
    }
  }
  for (const session of Object.values(input.sessions)) take(session.id, null, session.runs)
  for (const agent of Object.values(input.agents)) take(agent.sessionId, agent.agentId, agent.runs)
  return lines
}

/** Lines in a row it takes to fold them (Lucas picked three, CEL-160). */
const MIN_TO_FOLD = 3

/**
 * Folds each run of lines before a comment (or before the first one) into one row that keeps its test
 * lines and its newest line visible (CEL-181: a result never folds away), when it has three or more and
 * something would be hidden. The run after the newest comment stays open: it's what just happened.
 * Comments never fold.
 */
export const foldRuns = <C>(items: ReadonlyArray<TimelineItem<C>>): ReadonlyArray<ThreadItem<C>> => {
  const out: Array<ThreadItem<C>> = []
  let run: Array<LineItem<C>> = []
  const flush = (trailing: boolean) => {
    const lines = run.map((r) => r.line)
    const newest = lines[lines.length - 1]
    const visible = lines.filter((line) => line === newest || isTestLine(line))
    if (run.length >= MIN_TO_FOLD && !trailing && visible.length < lines.length) {
      out.push({ kind: "fold", id: `fold:${lines[0]!.id}`, lines, newest: newest!, visible })
    } else {
      out.push(...run)
    }
    run = []
  }
  for (const item of items) {
    if (item.kind === "line") run.push(item)
    else {
      flush(false)
      out.push(item)
    }
  }
  flush(true)
  return out
}

/** "3 earlier": how many lines the fold hides; its test lines and its newest line show. */
export const foldText = (fold: TimelineFold): string => `${fold.lines.length - fold.visible.length} earlier`

const agentName = (agentType: string | null): string => agentType ?? "A subagent"

/** One line in plain words: "In Progress → In Review", "cello-code-reviewer finished in 12 min", "Merged into main". */
export const timelineLineText = (line: TimelineLine): string => {
  switch (line.kind) {
    case "stage":
      return `Stage: ${stageInfo(line.stage)?.label ?? line.stage}`
    case "merge":
      return "Merged into main"
    case "status":
      return `${line.from} → ${line.to}`
    case "run_start":
      return `${agentName(line.agentType)} ${line.resumed ? "resumed" : "started"}`
    case "run_end":
      return `${agentName(line.agentType)} finished in ${runLength(line.durationMs)}`
    case "release":
      return `Released in v${line.build.version} · build #${line.build.number}`
    case "tests":
      return line.runs > 1 ? `${line.words} · ${line.runs} runs` : line.words
    case "tests_live":
      return `Running ${line.words}`
  }
}

/** A reviewer's verdict as the chip says it; `ask` names the human it asks (the project's human actor). */
export const verdictLabel = (verdict: ReviewVerdictSeen, humanName: string | null): string => {
  switch (verdict) {
    case "merge":
      return "Merge"
    case "fix_first":
      return "Fix first"
    case "ask":
      return humanName ? `Ask ${humanName}` : "Ask"
    case "other":
      return "Reviewed"
  }
}
