// CEL-160: a task's thread in time order: comments as cards, and between them one line per thing that
// happened (a stage, a status move, a subagent starting or finishing, the merge, the release), with runs of
// lines folded.
import type { BuildRecord } from "@cello/contract/build"
import type { EventBody, StreamedEvent } from "@cello/contract/events"
import type { AgentRun, TaskTimeline } from "@cello/contract/views"
import { describe, expect, it } from "vitest"
import { foldRuns, foldText, timelineLineText, timelineOf, verdictLabel, type TimelineItem } from "./timeline.ts"

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
