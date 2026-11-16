import type { BoardState } from "@cello/client/sync/applyEvents"
import { EMPTY_FILTER, matchContext } from "@cello/client/sync/filters"
import type { AgentSession, Label, LabelGroup, Milestone, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import {
  agentBox,
  claimSessions,
  filterKey,
  filterSummary,
  labelSections,
  milestoneRows,
  sanitize,
  shownFilter,
  toggleAgent,
  toggleSession,
  TOP_AREAS,
} from "./facets.ts"

const label = (name: string, group: LabelGroup): Label => ({
  id: `l-${name}`, workspaceId: "w1", projectId: "p1", name, color: "#000", group, createdAt: 0, updatedAt: 0, archivedAt: null,
})
const task = (n: number, labels: ReadonlyArray<string>, extra: Partial<Task> = {}): Task => ({
  id: `t${n}`, projectId: "p1", number: n, key: `CEL-${n}`, title: `T${n}`, description: "", statusId: "todo", priority: 0, position: "a0", commentCount: 0, lastCommentAt: null,
  dueDate: null, parentId: null, labelIds: labels.map((l) => `l-${l}`), assigneeActorId: null, assigneeSessionId: null,
  createdByActorId: "me", createdBySessionId: null, updatedByActorId: null, updatedBySessionId: null, stage: null, version: 1,
  createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})

const AREAS = ["agents", "board", "cli", "data", "desktop", "list", "pages", "release", "review", "search", "server", "sidebar", "task-panel", "tests", "viewer"]
const labels = [
  ...["feature", "bug", "polish", "chore", "docs"].map((n) => label(n, "kind")),
  ...AREAS.map((n) => label(n, "area")),
  label("M2", "milestone"),
  label("M3", "milestone"),
  label("someday", "none"),
]
// agents on 5 tasks, cli 4, board 3, pages 3, server 2, desktop 2, the rest 1 or none; feature on most.
const tasks = [
  task(1, ["feature", "agents", "cli"]),
  task(2, ["feature", "agents", "board"]),
  task(3, ["bug", "agents", "cli", "pages"]),
  task(4, ["feature", "agents", "board", "server"]),
  task(5, ["chore", "agents", "cli", "desktop"]),
  task(6, ["feature", "cli", "pages", "server"]),
  task(7, ["polish", "board", "pages", "desktop", "M2"]),
  task(8, ["docs", "viewer", "search"]),
]

const names = (rows: ReadonlyArray<Label>) => rows.map((l) => l.name)

describe("labelSections: Kind, Area (top 6, then Show all), Other", () => {
  it("kinds by how many tasks carry them; the 6 busiest areas, the rest hidden", () => {
    const [kind, area, other, ...rest] = labelSections(labels, tasks, [], false)
    expect(kind).toMatchObject({ group: "kind", heading: "Kind", hidden: 0 })
    expect(names(kind!.rows)).toEqual(["feature", "bug", "chore", "docs", "polish"])
    expect(area).toMatchObject({ group: "area", heading: "Area", size: 15, hidden: 9 })
    expect(names(area!.rows)).toEqual(["agents", "cli", "board", "pages", "desktop", "server"])
    expect(TOP_AREAS).toBe(6)
    // Milestones have their own section now (CEL-113): a label still in the old Milestone group is
    // listed under Other, so the panel has one Milestone heading, the real one.
    expect(other).toMatchObject({ group: "none", heading: "Other" })
    expect(names(other!.rows)).toEqual(["M2", "M3", "someday"])
    expect(rest).toEqual([])
  })

  it("Show all adds the other 9 under the top 6, A to Z, without moving the top 6", () => {
    const area = labelSections(labels, tasks, [], true)[1]!
    expect(names(area.rows)).toEqual(["agents", "cli", "board", "pages", "desktop", "server", "data", "list", "release", "review", "search", "sidebar", "task-panel", "tests", "viewer"])
    expect(area.hidden).toBe(0)
  })

  it("a picked area always shows, even outside the top 6", () => {
    const area = labelSections(labels, tasks, ["viewer"], false)[1]!
    expect(names(area.rows)).toEqual(["agents", "cli", "board", "pages", "desktop", "server", "viewer"])
    expect(area.hidden).toBe(8)
  })

  it("the order comes from the whole project, so picking a filter doesn't move rows", () => {
    expect(names(labelSections(labels, tasks, ["bug"], false)[1]!.rows)).toEqual(names(labelSections(labels, tasks, [], false)[1]!.rows))
  })

  it("empty groups are left out; with no groups at all, one list without a heading", () => {
    const ungrouped = [label("ui", "none"), label("server", "none")]
    expect(labelSections(ungrouped, tasks, [], false)).toEqual([{ group: "none", heading: null, rows: [ungrouped[1], ungrouped[0]], size: 2, hidden: 0 }])
  })
})

const milestone = (name: string, position: string, extra: Partial<Milestone> = {}): Milestone => ({
  id: `m-${name}`, projectId: "p1", name, goal: "", targetDate: null, position, state: "open", closedAt: null, createdAt: 0, updatedAt: 0, ...extra,
})
// In the order Lucas set: M1 (closed), M2, M3.
const milestones = [milestone("M1", "a0", { state: "closed", closedAt: 5 }), milestone("M2", "a1"), milestone("M3", "a2")]

describe("milestoneRows: the Milestone section's rows (CEL-113)", () => {
  it("the open milestones in order; a closed one only while it's picked, so it can be unticked", () => {
    expect(milestoneRows(milestones, []).map((m) => m.name)).toEqual(["M2", "M3"])
    expect(milestoneRows(milestones, ["m1"]).map((m) => m.name)).toEqual(["M1", "M2", "M3"])
    expect(milestoneRows(milestones, ["none"]).map((m) => m.name)).toEqual(["M2", "M3"])
    expect(milestoneRows([], [])).toEqual([])
  })
})

const session = (id: string, lastSeenAt: number, endedAt: number | null = null): AgentSession => ({
  id, actorId: "claude", externalId: `${id}-ext`, clientName: "Claude Code", entrypoint: null, cwd: null, pid: 1, startedAt: 0, lastSeenAt, endedAt,
})
const now = 10 * 60 * 60_000

describe("claimSessions: who holds claims in the project, live first", () => {
  it("active, then quiet, then ended; picked sessions show even without a claim", () => {
    const board = {
      sessions: {
        quiet: session("quiet", now - 12 * 60_000),
        live: session("live", now - 60_000),
        gone: session("gone", now - 60_000, now - 30_000),
        other: session("other", now),
        released: session("released", now),
      },
    } as unknown as BoardState
    const held = [
      task(1, [], { assigneeActorId: "claude", assigneeSessionId: "gone" }),
      task(2, [], { assigneeActorId: "claude", assigneeSessionId: "quiet" }),
      task(3, [], { assigneeActorId: "claude", assigneeSessionId: "live" }),
      task(4, [], { assigneeActorId: "claude", assigneeSessionId: "live" }),
      task(5, [], { assigneeActorId: "claude", assigneeSessionId: "unknown" }),
    ]
    expect(claimSessions(board, held, [], now).map((s) => s.id)).toEqual(["live", "quiet", "gone"])
    expect(claimSessions(board, held, ["released"], now).map((s) => s.id)).toEqual(["released", "live", "quiet", "gone"])
  })
})

describe("An agent and its sessions", () => {
  const listed = ["s1", "s2", "s3"]

  it("ticking An agent picks every agent; again, none", () => {
    const on = toggleAgent({ ...EMPTY_FILTER, sessions: ["s1"] })
    expect(on).toMatchObject({ holder: ["agent"], sessions: [] })
    expect(agentBox(on)).toBe("on")
    expect(toggleAgent(on)).toMatchObject({ holder: [], sessions: [] })
  })

  it("ticking some sessions makes the box a dash; ticking them all is An agent", () => {
    const one = toggleSession(EMPTY_FILTER, "s1", listed)
    expect(one.sessions).toEqual(["s1"])
    expect(agentBox(one)).toBe("some")
    const two = toggleSession(one, "s2", listed)
    expect(agentBox(two)).toBe("some")
    const all = toggleSession(two, "s3", listed)
    expect(all).toMatchObject({ holder: ["agent"], sessions: [] })
    expect(toggleSession(one, "s1", listed)).toMatchObject({ sessions: [] })
    expect(agentBox(EMPTY_FILTER)).toBe("off")
  })

  it("unticking one session while An agent is on keeps the others", () => {
    const f = toggleSession({ ...EMPTY_FILTER, holder: ["agent", "nobody"] }, "s2", listed)
    expect(f).toMatchObject({ holder: ["nobody"], sessions: ["s1", "s3"] })
    expect(agentBox(f)).toBe("some")
  })
})

describe("the filter shown, and kept per project on this device", () => {
  it("says how much a filter shows where the panel is hidden: Filtered: 6 of 30", () => {
    expect(filterSummary(6, 30)).toBe("Filtered: 6 of 30 tasks")
    expect(filterSummary(1, 1)).toBe("Filtered: 1 of 1 task")
  })

  it("one key per project, shared by board and list", () => {
    expect(filterKey("cel")).toBe("cello:filter:CEL")
  })

  it("a link with a filter wins; without one, the kept filter shows", () => {
    const kept = { ...EMPTY_FILTER, labels: ["bug"] }
    expect(shownFilter({ label: "agents" }, kept)).toMatchObject({ labels: ["agents"] })
    expect(shownFilter({ layout: "list" }, kept)).toEqual(kept)
    expect(shownFilter({}, EMPTY_FILTER)).toEqual(EMPTY_FILTER)
  })

  it("labels, milestones and sessions the board doesn't have are dropped; No milestone stays", () => {
    const board = {
      labels: Object.fromEntries(labels.map((l) => [l.id, l])),
      milestones: Object.fromEntries(milestones.map((m) => [m.id, m])),
      sessions: { s1: session("s1", now) },
    } as unknown as BoardState
    const c = matchContext(board, { projectId: "p1" }, now)
    expect(sanitize({ ...EMPTY_FILTER, labels: ["bug", "gone"], milestones: ["m1", "m9", "none"], sessions: ["s1", "s9"], holder: ["human"] }, c)).toEqual({
      ...EMPTY_FILTER,
      labels: ["bug"],
      milestones: ["m1", "none"],
      sessions: ["s1"],
      holder: ["human"],
    })
  })
})
