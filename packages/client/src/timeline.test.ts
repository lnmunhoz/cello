// CEL-160: a task's thread in time order: comments as cards, and between them one line per thing that
// happened (a stage, a status move, a subagent starting or finishing, the merge, the release), with runs of
// lines folded.
import type { BuildRecord } from "@cello/contract/build"
import type { EventBody, StreamedEvent } from "@cello/contract/events"
import { type AgentSession, agentKey, type SessionAgent, type TestRun } from "@cello/contract/entities"
import type { AgentRun, TaskTimeline } from "@cello/contract/views"
import { STALE_RUN_MS } from "@cello/shared/testRun"
import { describe, expect, it } from "vitest"
import { foldRuns, foldText, liveTestLines, testKeysOf, timelineLineText, timelineOf, type ThreadItem, verdictLabel, type TimelineItem } from "./timeline.ts"

const statuses = {
  doing: { name: "In Progress" },
  review: { name: "In Review" },
  todo: { name: "Todo" },
}

const ev = (seq: number, ts: number, body: EventBody): StreamedEvent =>
  ({ seq, ts, commandId: "c", actorId: "me", sessionId: null, agentId: null, model: null, effort: null, workspaceId: "w", projectId: "p", schemaVersion: 1, ...body }) as StreamedEvent

const stage = (seq: number, ts: number, before: string | null, after: string | null) =>
  ev(seq, ts, { type: "task.stage_changed", id: "t", version: seq, before, after } as EventBody)
const moved = (seq: number, ts: number, from: string, to: string) =>
  ev(seq, ts, { type: "task.moved", id: "t", from: { statusId: from, position: "a" }, to: { statusId: to, position: "b" }, version: seq, task: {} as never })

const run = (over: Partial<AgentRun> = {}): AgentRun => ({
  sessionId: "s", agentId: "a1", agentType: "cello-builder", model: "claude-sonnet-5-5", effort: "high", startedAt: 1_000, endedAt: null, verdict: null, ...over,
})
const build = (over: Partial<BuildRecord> = {}): BuildRecord => ({
  id: "b", number: 53, version: "0.4.9", commit: "abc", webBuiltAt: 1, startedAt: 90_000, lastStartedAt: 90_000, liveUntil: null, changes: [], ...over,
})
const comment = (id: string, createdAt: number) => ({ id, createdAt })

const input = (over: { comments?: ReadonlyArray<{ id: string; createdAt: number }>; history?: ReadonlyArray<StreamedEvent> } & Partial<TaskTimeline> = {}) => ({
  comments: over.comments ?? [],
  history: over.history ?? [],
  timeline: { runs: over.runs ?? [], releases: over.releases ?? [] },
  statuses,
})

const shape = (items: ReadonlyArray<TimelineItem<{ id: string }>>) =>
  items.map((i) => (i.kind === "comment" ? `comment ${i.comment.id}` : `${i.line.kind} @${i.line.ts}`))

/** The words of each line, in order. */
const words = (items: ReadonlyArray<TimelineItem<{ id: string }>>) => items.flatMap((i) => (i.kind === "line" ? [timelineLineText(i.line)] : []))

describe("timelineOf", () => {
  it("puts comments, history lines, runs and releases in time order", () => {
    const items = timelineOf(input({
      comments: [comment("c1", 100), comment("c2", 5_000)],
      history: [stage(1, 200, null, "building"), stage(2, 4_000, "building", "review"), moved(3, 80_000, "doing", "review"), stage(4, 70_000, "fixing", "merged")],
      runs: [run({ startedAt: 300, endedAt: 3_000 })],
      releases: [build({ startedAt: 90_000 })],
    }))
    expect(shape(items)).toEqual([
      "comment c1", "stage @200", "run_start @300", "run_end @3000", "stage @4000", "comment c2", "merge @70000", "status @80000", "release @90000",
    ])
  })

  it("stage changes with a stage are lines, and merged is the merge; a cleared stage, a reorder, labels, titles, comments and claims are not", () => {
    const items = timelineOf(input({
      history: [
        stage(1, 1, null, "planning"),
        stage(2, 2, "planning", null),
        stage(3, 3, null, "merged"),
        stage(4, 4, "merged", "merging"),
        moved(5, 5, "todo", "todo"),
        ev(6, 6, { type: "task.labels_changed", id: "t", added: ["x"], removed: [], version: 2 } as EventBody),
        ev(7, 7, { type: "task.updated", id: "t", before: {}, after: { title: "b" }, version: 2 } as EventBody),
        ev(8, 8, { type: "task.milestone_changed", id: "t", version: 2, before: null, after: "m" } as EventBody),
        ev(9, 9, { type: "comment.added", comment: {} as never } as EventBody),
        ev(10, 10, { type: "reaction.added", reaction: {} as never } as EventBody),
        ev(11, 11, { type: "task.claimed", id: "t", version: 2, task: {} as never } as EventBody),
        ev(12, 12, { type: "agent.seen", agent: {} as never } as EventBody),
        { type: "unreadable", seq: 13, ts: 13, sentType: "task.future" } as StreamedEvent,
      ],
    }))
    expect(items.map((i) => (i.kind === "line" ? [i.line.kind, i.line.kind === "stage" ? i.line.stage : null] : null))).toEqual([
      ["stage", "planning"], ["merge", null], ["stage", "merging"],
    ])
  })

  it("a move to another status is a line, naming both", () => {
    expect(words(timelineOf(input({ history: [moved(1, 10, "doing", "review")] })))).toEqual(["In Progress → In Review"])
  })

  it("a run is a start line and, once it ended, a finish line; a reviewer's verdict rides on the finish; a resume says so", () => {
    const items = timelineOf(input({
      runs: [
        run({ agentType: "cello-code-reviewer", agentId: "r", startedAt: 1_000, endedAt: 721_000, verdict: "fix_first", model: "claude-sonnet-5-5", effort: "medium" }),
        run({ agentType: "cello-code-reviewer", agentId: "r", startedAt: 800_000, endedAt: null, model: "claude-sonnet-5-5", effort: "medium" }),
      ],
    }))
    const lines = items.flatMap((i) => (i.kind === "line" ? [i.line] : []))
    expect(words(items)).toEqual([
      "cello-code-reviewer started",
      "cello-code-reviewer finished in 12 min",
      "cello-code-reviewer resumed",
    ])
    expect(lines[0]).toMatchObject({ kind: "run_start", running: false, model: "Sonnet 5.5, medium" })
    expect(lines[1]).toMatchObject({ kind: "run_end", verdict: "fix_first" })
    expect(lines[2]).toMatchObject({ kind: "run_start", running: true, model: "Sonnet 5.5, medium" })
  })

  it("an agent with no type is a subagent", () => {
    expect(words(timelineOf(input({ runs: [run({ agentType: null })] })))).toEqual(["A subagent started"])
  })

  it("a release says its version and build; the merge says it went into main; a stage says its name", () => {
    expect(words(timelineOf(input({ releases: [build()] })))).toEqual(["Released in v0.4.9 · build #53"])
    expect(words(timelineOf(input({ history: [stage(1, 1, null, "merged"), stage(2, 2, null, "review"), stage(3, 3, "fixing", "merging")] })))).toEqual([
      "Merged into main", "Stage: Agent review", "Stage: Approved · merging",
    ])
  })
})

const stages = (n: number, from = 10) =>
  Array.from({ length: n }, (_, i) => stage(100 + from + i, from + i, null, "building"))

const folded = (items: ReadonlyArray<TimelineItem<{ id: string }>>) =>
  foldRuns(items).map((i) => (i.kind === "comment" ? `comment ${i.comment.id}` : i.kind === "fold" ? `fold ${i.lines.length} newest @${i.newest.ts}` : `line @${i.line.ts}`))

// Lucas picked this fold (Nov 18): three or more lines in a row fold, the newest stays visible, and the run
// after the newest comment stays open.
describe("foldRuns", () => {
  const thread = (...runs: number[]) =>
    timelineOf(input({
      comments: runs.map((_, i) => comment(`c${i + 1}`, 1 + i * 100)),
      history: runs.flatMap((n, i) => stages(n, 10 + i * 100)),
    }))

  it("folds a run of three or more into one row that keeps its newest line; one or two lines stay", () => {
    expect(folded(thread(3, 2, 4))).toEqual(["comment c1", "fold 3 newest @12", "comment c2", "line @110", "line @111", "comment c3", "line @210", "line @211", "line @212", "line @213"])
    expect(folded(thread(1, 2))).toEqual(["comment c1", "line @10", "comment c2", "line @110", "line @111"])
  })

  it("the run after the newest comment stays open however long; with no comment at all the one run is the newest", () => {
    expect(folded(timelineOf(input({ history: stages(4) })))).toEqual(["line @10", "line @11", "line @12", "line @13"])
    expect(folded(thread(5))).toEqual(["comment c1", "line @10", "line @11", "line @12", "line @13", "line @14"])
  })

  it("lines before the first comment fold like any run", () => {
    const items = timelineOf(input({ comments: [comment("c1", 500)], history: stages(3, 10) }))
    expect(folded(items)).toEqual(["fold 3 newest @12", "comment c1"])
  })

  it("a newest comment with nothing after it leaves every earlier run folded", () => {
    const done = timelineOf(input({ comments: [comment("c1", 1), comment("c2", 500)], history: stages(3, 10) }))
    expect(folded(done)).toEqual(["comment c1", "fold 3 newest @12", "comment c2"])
  })

  it("a fold carries all its lines in order, and says how many came before the newest", () => {
    const fold = foldRuns(timelineOf(input({ comments: [comment("c1", 1), comment("c2", 500)], history: stages(4, 10) }))).find((i) => i.kind === "fold")
    expect(fold && fold.kind === "fold" && fold.lines.map((l) => l.ts)).toEqual([10, 11, 12, 13])
    expect(fold && fold.kind === "fold" && fold.newest.ts).toBe(13)
    expect(fold && fold.kind === "fold" && foldText(fold)).toBe("3 earlier")
  })
})

describe("verdictLabel", () => {
  it("says what the reviewer concluded; asking names the human; a word this build doesn't know is just a review", () => {
    expect(verdictLabel("merge", "Lucas")).toBe("Merge")
    expect(verdictLabel("fix_first", "Lucas")).toBe("Fix first")
    expect(verdictLabel("ask", "Lucas")).toBe("Ask Lucas")
    expect(verdictLabel("ask", null)).toBe("Ask")
    expect(verdictLabel("other", "Lucas")).toBe("Reviewed")
  })
})

// ── CEL-181: how an agent's test run turned out ────────────────────────────────────────────────────

const testRun = (over: Partial<TestRun> = {}): TestRun => ({
  label: "web e2e", command: "bun run test:e2e -- e2e/pages.spec.ts", startedAt: 1_000, endedAt: 105_000, outcome: "passed", background: true, taskId: "t",
  progress: { stage: "web-e2e", passed: 3, failed: 0, skipped: 0, total: 3, current: null, failures: [], done: true, outcome: "passed", folder: null },
  ...over,
})
const unitRun = (startedAt: number, outcome: "passed" | "failed", over: Partial<TestRun> = {}): TestRun =>
  testRun({ label: "unit tests", command: "bun run test", startedAt, endedAt: startedAt + 40_000, outcome, background: false, progress: null, ...over })

/** `tests.finished` as the server writes it: the session and, for a subagent, its id on the envelope. */
const finished = (seq: number, run: TestRun, who: { sessionId?: string; agentId?: string | null } = {}): StreamedEvent =>
  ({
    seq, ts: run.endedAt ?? 0, commandId: "c", actorId: "claude", sessionId: who.sessionId ?? "s", agentId: who.agentId === undefined ? "a1" : who.agentId,
    model: null, effort: null, workspaceId: "w", projectId: "p", schemaVersion: 1, type: "tests.finished", taskId: "t", run,
  }) as StreamedEvent

const kinds = (items: ReadonlyArray<ThreadItem<{ id: string }>>) =>
  items.map((i) => (i.kind === "comment" ? `comment ${i.comment.id}` : i.kind === "fold" ? `fold ${foldText(i)} [${i.visible.map((l) => l.kind).join(",")}]` : i.line.kind))

describe("a finished test run (CEL-181)", () => {
  it("tests.finished is a `tests` line: its key, who ran it, the words, the failures, and where it sorts and what time it shows", () => {
    const failing = testRun({
      outcome: "failed", progress: { stage: "web-e2e", passed: 2, failed: 1, skipped: 0, total: 3, current: null, failures: ["e2e/pages.spec.ts:40 › opens"], done: true, outcome: "failed", folder: "/repo/wt/test-results/docker/x" },
    })
    const [item] = timelineOf(input({ history: [finished(5, failing)] }))
    expect(item).toMatchObject({ kind: "line", id: "tests:s:a1:1000", ts: 1_000 })
    expect(item?.kind === "line" && item.line).toMatchObject({
      kind: "tests", id: "tests:s:a1:1000", ts: 1_000, endedAt: 105_000, label: "web e2e", outcome: "failed", command: "bun run test:e2e -- e2e/pages.spec.ts",
      words: "web e2e failed · e2e/pages.spec.ts · 1 failed of 3 · 1m44s", failures: ["e2e/pages.spec.ts:40 › opens"], folder: "/repo/wt/test-results/docker/x", runs: 1, earlier: [],
      doer: { actorId: "claude", sessionId: "s", agentId: "a1" },
    })
    // The main session's run has no agent: its key says so.
    expect(timelineOf(input({ history: [finished(6, testRun(), { agentId: null })] }))[0]).toMatchObject({ id: "tests:s:-:1000" })
  })

  it("in the CEL-177 story it sits under the comment that announced it and before the status move; a comment written during the run comes after it", () => {
    const items = timelineOf(input({
      comments: [comment("announce", 500), comment("lucas", 50_000)],
      history: [finished(5, testRun({ startedAt: 1_000, endedAt: 105_000 })), moved(6, 110_000, "doing", "review")],
    }))
    expect(shape(items)).toEqual(["comment announce", "tests @1000", "comment lucas", "status @110000"])
    expect(words(items)).toEqual(["web e2e passed · e2e/pages.spec.ts · 3 of 3 · 1m44s", "In Progress → In Review"])
  })

  it("an event with no readable run stays out; an unreadable one is skipped", () => {
    expect(timelineOf(input({ history: [{ type: "unreadable", seq: 3, ts: 3, sentType: "tests.future" } as StreamedEvent] }))).toEqual([])
  })

  it("timelineLineText: the words, and \" · 3 runs\" only when several collapsed", () => {
    const [one] = timelineOf(input({ history: [finished(5, testRun())] }))
    expect(one?.kind === "line" && timelineLineText(one.line)).toBe("web e2e passed · e2e/pages.spec.ts · 3 of 3 · 1m44s")
    const three = timelineOf(input({ history: [finished(1, unitRun(1_000, "failed")), finished(2, unitRun(60_000, "failed")), finished(3, unitRun(120_000, "passed"))] }))
    expect(words(three)).toEqual(["unit tests passed · 40s · 3 runs"])
  })
})

describe("collapsing repeated runs (CEL-181)", () => {
  it("runs of one kind with only test lines between them collapse into the last; the earlier outcomes ride on it", () => {
    const items = timelineOf(input({
      history: [finished(1, unitRun(1_000, "failed", { progress: { stage: "unit", passed: 3, failed: 1, skipped: 0, total: 4, current: null, failures: ["a.test.ts › x"], done: true, outcome: "failed", folder: null } })),
        finished(2, unitRun(60_000, "failed")), finished(3, unitRun(120_000, "passed"))],
    }))
    expect(items).toHaveLength(1)
    const line = items[0]!.kind === "line" ? items[0]!.line : null
    expect(line).toMatchObject({ kind: "tests", id: "tests:s:a1:120000", runs: 3, outcome: "passed", ts: 120_000 })
    expect(line?.kind === "tests" && line.earlier.map((e) => [e.outcome, e.endedAt, e.failures])).toEqual([["failed", 41_000, ["a.test.ts › x"]], ["failed", 100_000, []]])
  })

  it("a comment, a status move, a stage or an agent run between them keeps them apart; different kinds don't collapse; others' runs in between don't either", () => {
    const apart = (between: Parameters<typeof input>[0]) =>
      shape(timelineOf(input({ history: [finished(1, unitRun(1_000, "failed")), finished(3, unitRun(200_000, "passed"))], ...between })))
    expect(apart({ comments: [comment("c", 100_000)] })).toEqual(["tests @1000", "comment c", "tests @200000"])
    expect(apart({ history: [finished(1, unitRun(1_000, "failed")), moved(2, 100_000, "doing", "review"), finished(3, unitRun(200_000, "passed"))] })).toEqual(["tests @1000", "status @100000", "tests @200000"])
    expect(apart({ runs: [run({ startedAt: 100_000, endedAt: 150_000 })] })).toEqual(["tests @1000", "run_start @100000", "run_end @150000", "tests @200000"])
    // Different labels stay two lines.
    const two = timelineOf(input({ history: [finished(1, unitRun(1_000, "passed")), finished(2, testRun({ startedAt: 50_000, endedAt: 90_000 }))] }))
    expect(shape(two)).toEqual(["tests @1000", "tests @50000"])
    // A web run in between two unit runs doesn't stop them collapsing: only test lines are between.
    const mixed = timelineOf(input({ history: [finished(1, unitRun(1_000, "failed")), finished(2, testRun({ startedAt: 50_000, endedAt: 90_000 })), finished(3, unitRun(100_000, "passed"))] }))
    expect(shape(mixed)).toEqual(["tests @50000", "tests @100000"])
  })
})

describe("folding keeps the results (CEL-181)", () => {
  const stageAt = (seq: number, ts: number) => stage(seq, ts, null, "building")

  it("a closed fold shows its test lines and its newest line; the button counts only what is hidden", () => {
    const items = timelineOf(input({
      comments: [comment("c1", 1), comment("c2", 500_000)],
      history: [stageAt(1, 10), finished(2, unitRun(20_000, "passed")), stageAt(3, 100_000), moved(4, 110_000, "doing", "review")],
    }))
    const fold = foldRuns(items).find((i) => i.kind === "fold")
    expect(fold && fold.kind === "fold" && foldText(fold)).toBe("2 earlier")
    expect(kinds(foldRuns(items))).toEqual(["comment c1", "fold 2 earlier [tests,status]", "comment c2"])
    // All of it is still in the fold, in order, for when it opens.
    expect(fold && fold.kind === "fold" && fold.lines.map((l) => l.kind)).toEqual(["stage", "tests", "stage", "status"])
  })

  it("a stretch where nothing would be hidden doesn't fold", () => {
    const items = timelineOf(input({
      comments: [comment("c1", 1), comment("c2", 900_000)],
      history: [finished(1, unitRun(20_000, "failed")), finished(2, testRun({ startedAt: 100_000, endedAt: 150_000 })), finished(3, testRun({ label: "desktop e2e", startedAt: 200_000, endedAt: 250_000 }))],
    }))
    expect(kinds(foldRuns(items))).toEqual(["comment c1", "tests", "tests", "tests", "comment c2"])
  })

  it("the stretch after the newest comment never folds, however many lines", () => {
    const items = timelineOf(input({ comments: [comment("c1", 1)], history: [stageAt(1, 10), stageAt(2, 11), stageAt(3, 12), stageAt(4, 13)] }))
    expect(kinds(foldRuns(items))).toEqual(["comment c1", "stage", "stage", "stage", "stage"])
  })
})

// ── CEL-181: the live row, and how it turns into the finished line ───────────────────────────────────

describe("liveTestLines (CEL-181)", () => {
  const NOW = 71_000
  const runningRun = (over: Partial<TestRun> = {}): TestRun =>
    testRun({
      startedAt: 1_000, endedAt: null, outcome: null,
      progress: { stage: "web-e2e", passed: 1, failed: 0, skipped: 0, total: 3, current: null, failures: [], done: false, outcome: null, folder: null },
      ...over,
    })
  const session = (runs: ReadonlyArray<TestRun>, over: Partial<AgentSession> = {}): AgentSession =>
    ({ id: "s", actorId: "claude", externalId: null, clientName: "Claude Code", entrypoint: null, cwd: null, pid: null, startedAt: 1, lastSeenAt: 2, endedAt: null, runs, ...over })
  const agent = (runs: ReadonlyArray<TestRun>, over: Partial<SessionAgent> = {}): SessionAgent =>
    ({ sessionId: "s", agentId: "a1", agentType: "cello-builder", taskId: "t", description: null, startedAt: 1, lastSeenAt: 2, endedAt: null, runs, ...over })
  const live = (over: { sessions?: ReadonlyArray<AgentSession>; agents?: ReadonlyArray<SessionAgent>; history?: ReadonlyArray<StreamedEvent>; now?: number; taskId?: string } = {}) =>
    liveTestLines({
      taskId: over.taskId ?? "t",
      sessions: Object.fromEntries((over.sessions ?? [session([])]).map((s) => [s.id, s])),
      agents: Object.fromEntries((over.agents ?? []).map((a) => [agentKey(a.sessionId, a.agentId), a])),
      known: testKeysOf(over.history ?? []),
      now: over.now ?? NOW,
    })

  it("a subagent's running run on this task is a `tests_live` line at its start: its key, its words with the elapsed time, who", () => {
    const lines = live({ agents: [agent([runningRun()])] })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      kind: "tests_live", id: "tests:s:a1:1000", ts: 1_000, label: "web e2e", words: "web e2e · e2e/pages.spec.ts · 1 of 3 · 1m10s", failed: 0,
      doer: { actorId: "claude", sessionId: "s", agentId: "a1" },
    })
  })

  it("a main session's running run on this task does the same; a run on another task, or with no task, gives none", () => {
    expect(live({ sessions: [session([runningRun()])] })[0]).toMatchObject({ kind: "tests_live", id: "tests:s:-:1000", doer: { agentId: null } })
    expect(live({ sessions: [session([runningRun({ taskId: "other" })])] })).toEqual([])
    expect(live({ sessions: [session([runningRun({ taskId: null })])] })).toEqual([])
    const { taskId: _gone, ...old } = runningRun()
    expect(live({ sessions: [session([old as TestRun])] })).toEqual([])
    expect(live({ sessions: [session([runningRun()])], taskId: "other" })).toEqual([])
  })

  it("two running runs on this task give two lines, each at its own start; failures count", () => {
    const docker = runningRun({ startedAt: 1_000, progress: { stage: "web-e2e", passed: 1, failed: 1, skipped: 0, total: 3, current: null, failures: ["x"], done: false, outcome: null, folder: null } })
    const lines = live({ agents: [agent([docker, unitRun(30_000, "passed", { endedAt: null, outcome: null })])] })
    expect(lines.map((l) => [l.kind, l.ts, l.kind === "tests_live" ? l.failed : null])).toEqual([["tests_live", 1_000, 1], ["tests_live", 30_000, 0]])
  })

  it("a run whose key is already in history gives nothing: history wins, so there's never a duplicate", () => {
    const done = testRun({ taskId: "t" })
    expect(live({ agents: [agent([done])], history: [finished(5, done)] })).toEqual([])
    expect(live({ agents: [agent([runningRun()])], history: [finished(5, testRun())] })).toEqual([])
  })

  it("an ended run not in history yet is a finished line, equal to the one history will give for it", () => {
    const done = testRun({ taskId: "t" })
    const fromPresence = live({ agents: [agent([done])] })
    expect(fromPresence).toHaveLength(1)
    const [fromHistory] = timelineOf(input({ history: [finished(5, done)] }))
    expect(fromHistory?.kind === "line" && fromHistory.line).toEqual(fromPresence[0])
  })

  it("a running run whose agent or session ended, or that is older than STALE_RUN_MS, gives nothing", () => {
    expect(live({ agents: [agent([runningRun()], { endedAt: 50_000 })] })).toEqual([])
    expect(live({ sessions: [session([], { endedAt: 50_000 })], agents: [agent([runningRun()])] })).toEqual([])
    expect(live({ sessions: [session([runningRun()], { endedAt: 50_000 })] })).toEqual([])
    expect(live({ sessions: [session([runningRun()])], now: 1_000 + STALE_RUN_MS })).toEqual([])
  })

  it("an agent the board doesn't know yet, or a run in no one's presence, gives nothing", () => {
    expect(live({ sessions: [], agents: [] })).toEqual([])
  })

  it("through timelineOf: a live line lands after the comment written just before its start, never folds, and never collapses with finished runs of its label", () => {
    const lines = live({ agents: [agent([unitRun(30_000, "passed", { endedAt: null, outcome: null })])] })
    const items = timelineOf({ ...input({ comments: [comment("announce", 29_000), comment("later", 90_000)], history: [finished(1, unitRun(1_000, "failed")), stage(2, 10_000, null, "building"), stage(3, 11_000, null, "fixing")] }), live: lines })
    expect(shape(items)).toEqual(["tests @1000", "stage @10000", "stage @11000", "comment announce", "tests_live @30000", "comment later"])
    // The live line is in a stretch of its own, after the announcing comment: nothing to fold.
    expect(kinds(foldRuns(items))).toEqual(["fold 1 earlier [tests,stage]", "comment announce", "tests_live", "comment later"])
  })

  it("live, then ended but not in history, then in history: one line with the same id at the same place in every phase", () => {
    const base = { comments: [comment("announce", 500)], history: [] as StreamedEvent[] }
    const phase = (agentRun: TestRun, history: ReadonlyArray<StreamedEvent>) =>
      timelineOf({ ...input({ ...base, history }), live: live({ agents: [agent([agentRun])], history }) })
    const running = phase(runningRun(), [])
    const ended = phase(testRun(), [])
    const inHistory = phase(testRun(), [finished(9, testRun())])
    const places = [running, ended, inHistory].map((items) => items.map((i) => [i.id, i.kind === "line" ? i.line.kind : "comment"]))
    expect(places).toEqual([
      [["announce", "comment"], ["tests:s:a1:1000", "tests_live"]],
      [["announce", "comment"], ["tests:s:a1:1000", "tests"]],
      [["announce", "comment"], ["tests:s:a1:1000", "tests"]],
    ])
    // The finished phases read the same on screen.
    expect(ended[1]).toEqual(inHistory[1])
  })
})
