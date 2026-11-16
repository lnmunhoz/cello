import type { Actor, Label, LabelGroup, Milestone, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import type { BoardState } from "./applyEvents.ts"
import {
  activeFields,
  applyFilter,
  clearField,
  countWith,
  EMPTY_FILTER,
  filterFromSearch,
  hasFilter,
  labelCount,
  matchContext,
  matches,
  milestonesInScope,
  parseFilterSearch,
  parseStoredFilter,
  searchFromFilter,
  storedFilter,
  type TaskFilter,
} from "./filters.ts"

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number: 1, key: `CEL-${id}`, title: id, description: "", statusId: "todo", priority: 0, position: "a0", commentCount: 0, lastCommentAt: null,
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me",
  createdBySessionId: null, updatedByActorId: null, updatedBySessionId: null, stage: null, version: 1, createdAt: 1, updatedAt: 1,
  archivedAt: null, ...extra,
})
const label = (id: string, group: LabelGroup, projectId = "p1", workspaceId = "w1"): Label => ({
  id, workspaceId, projectId, name: id, color: "#000", group, createdAt: 0, updatedAt: 0, archivedAt: null,
})
const milestone = (id: string, name: string, position: string, extra: Partial<Milestone> = {}): Milestone => ({
  id, projectId: "p1", name, goal: "", targetDate: null, position, state: "open", closedAt: null, createdAt: 0, updatedAt: 0, ...extra,
})
const actor = (id: string, kind: Actor["kind"]): Actor => ({ id, kind, name: id, client: null, color: "#000", createdAt: 0 })

const board = {
  projects: { p1: { id: "p1", workspaceId: "w1" }, p2: { id: "p2", workspaceId: "w1" }, p3: { id: "p3", workspaceId: "w2" } },
  labels: {
    bug: label("bug", "kind"),
    feature: label("feature", "kind"),
    agents: label("agents", "area"),
    board: label("board", "area"),
    m2: { ...label("m2", "milestone"), name: "M2" },
    someday: label("someday", "none"),
    // Another project's bug (CEL-80): not p1's, but the same "bug" in All projects.
    "p2-bug": { ...label("p2-bug", "kind", "p2"), name: "Bug" },
    // Another workspace's label with a taken name: never this workspace's.
    other: { ...label("other", "area", "p3", "w2"), name: "bug" },
  },
  // CEL-113: p1's M2, M3 and a closed M1, in the order Lucas set; THAI (p2) has its own M2, another workspace an M3.
  milestones: {
    ms3: milestone("ms3", "M3", "a2"),
    ms2: milestone("ms2", "M2", "a1"),
    ms1: milestone("ms1", "M1", "a0", { state: "closed", closedAt: 5 }),
    "p2-m2": milestone("p2-m2", "M2", "a0", { projectId: "p2" }),
    "w2-m3": milestone("w2-m3", "M3", "a0", { projectId: "p3" }),
  },
  actors: { me: actor("me", "human"), claude: actor("claude", "agent") },
  // c's packet waits in In Review; d's was left open when d moved on (before CEL-71): it isn't waiting.
  statuses: { todo: { id: "todo", name: "Todo", category: "unstarted" }, review: { id: "review", name: "In Review", category: "started" } },
  tasks: { c: { id: "c", statusId: "review" }, d: { id: "d", statusId: "todo" } },
  reviews: { r1: { id: "r1", taskId: "c" }, r2: { id: "r2", taskId: "d" } },
  asks: { k1: { id: "k1", taskId: "a" } },
} as unknown as BoardState
const now = new Date(2026, 10, 15, 12).getTime()
const c = matchContext(board, { projectId: "p1" }, now)

// a: a bug in agents, urgent, overdue, waiting on Lucas's answers, in milestone M2.
const a = task("a", { labelIds: ["bug", "agents"], priority: 1, dueDate: "2026-11-10", milestoneId: "ms2" })
// b: a feature in agents and board, held by agent session s1, made by it, in milestone M3.
const b = task("b", { labelIds: ["feature", "agents", "board"], assigneeActorId: "claude", assigneeSessionId: "s1", createdByActorId: "claude", createdBySessionId: "s1", milestoneId: "ms3" })
// c: a bug on the board, in M2, held by Lucas, due this week, with a review packet.
const cc = task("c", { labelIds: ["bug", "board", "m2"], assigneeActorId: "me", dueDate: "2026-11-18", title: "Drag cards", statusId: "review" })
// d: no labels, held by agent session S2.
const d = task("d", { assigneeActorId: "claude", assigneeSessionId: "S2", updatedAt: now - 3_600_000 })
const all = [a, b, cc, d]
const shown = (f: Partial<TaskFilter>) => all.filter((t) => matches(t, { ...EMPTY_FILTER, ...f }, c)).map((t) => t.id)

describe("labels: any within a group, all across groups (CEL-52)", () => {
  it("two kinds match either; a kind and an area match only tasks with both", () => {
    expect(shown({ labels: ["bug", "feature"] })).toEqual(["a", "b", "c"])
    expect(shown({ labels: ["bug", "agents"] })).toEqual(["a"])
    expect(shown({ labels: ["agents", "board"] })).toEqual(["a", "b", "c"])
    expect(shown({ labels: ["bug", "agents", "board"] })).toEqual(["a", "c"])
    expect(shown({ labels: ["bug", "m2"] })).toEqual(["c"])
  })

  it("a label still in the old Milestone group matches as an Other one, as the panel lists it (CEL-113)", () => {
    expect(c.labels.get("m2")).toEqual([{ id: "m2", group: "none" }])
    expect(shown({ labels: ["m2", "someday"] })).toEqual(["c"])
  })

  it("names match in any case, and a name the workspace doesn't have is left out", () => {
    expect(shown({ labels: ["BUG"] })).toEqual(["a", "c"])
    expect(shown({ labels: ["bug", "gone"] })).toEqual(["a", "c"])
    expect(shown({ labels: ["gone"] })).toEqual(["a", "b", "c", "d"])
  })

  it("an archived label stops matching", () => {
    const archived = matchContext({ ...board, labels: { ...board.labels, m2: { ...board.labels["m2"]!, archivedAt: 5 } } }, { projectId: "p1" }, now)
    expect(all.filter((t) => matches(t, { ...EMPTY_FILTER, labels: ["bug", "m2"] }, archived)).map((t) => t.id)).toEqual(["a", "c"])
  })

  it("counts a label with the other groups' picks applied, but not its own group's", () => {
    const f = { ...EMPTY_FILTER, labels: ["bug", "agents"] }
    // feature: kind is swapped for it, agents still applies → b.
    expect(labelCount(all, f, c, "feature")).toBe(1)
    // board: area is swapped for it, bug still applies → c.
    expect(labelCount(all, f, c, "board")).toBe(1)
    // bug, with agents → a.
    expect(labelCount(all, f, c, "bug")).toBe(1)
    expect(labelCount(all, EMPTY_FILTER, c, "agents")).toBe(2)
  })

  it("a project matches its own labels only; All projects matches every project's label of that name (CEL-80)", () => {
    // e: THAI's task with THAI's own Bug.
    const e = task("e", { projectId: "p2", labelIds: ["p2-bug"] })
    const f = { ...EMPTY_FILTER, labels: ["bug"] }
    expect([...all, e].filter((t) => matches(t, f, c)).map((t) => t.id)).toEqual(["a", "c"])
    expect(c.labels.get("bug")).toEqual([{ id: "bug", group: "kind" }])
    const everywhere = matchContext(board, { workspaceId: "w1" }, now)
    expect([...all, e].filter((t) => matches(t, f, everywhere)).map((t) => t.id)).toEqual(["a", "c", "e"])
    expect(labelCount([...all, e], EMPTY_FILTER, everywhere, "bug")).toBe(3)
    // Only another project has it: a project filter leaves the name out, All projects keeps it.
    expect(matchContext(board, { projectId: "p2" }, now).labels.has("agents")).toBe(false)
    expect(everywhere.labels.has("agents")).toBe(true)
  })
})

describe("milestones: any picked one, or No milestone (CEL-113)", () => {
  it("one milestone, several, or none; names in any case", () => {
    expect(shown({ milestones: ["m2"] })).toEqual(["a"])
    expect(shown({ milestones: ["M2", "m3"] })).toEqual(["a", "b"])
    expect(shown({ milestones: ["none"] })).toEqual(["c", "d"])
    expect(shown({ milestones: ["m3", "none"] })).toEqual(["b", "c", "d"])
    // A task from an event stored before milestones leaves milestoneId out: it has none.
    const { milestoneId: _, ...old } = task("old")
    expect(matches(old, { ...EMPTY_FILTER, milestones: ["none"] }, c)).toBe(true)
  })

  it("combines with the other facets, and a count leaves its own picks out", () => {
    expect(shown({ milestones: ["m2", "m3"], labels: ["bug"] })).toEqual(["a"])
    const f = { ...EMPTY_FILTER, milestones: ["m2"], holder: ["agent" as const] }
    expect(shown(f)).toEqual([])
    expect(countWith(all, f, c, "milestones", { milestones: ["m3"] })).toBe(1)
    expect(countWith(all, f, c, "milestones", { milestones: ["none"] })).toBe(1)
    expect(countWith(all, EMPTY_FILTER, c, "milestones", { milestones: ["none"] })).toBe(2)
    expect(activeFields({ ...EMPTY_FILTER, milestones: ["none"] })).toEqual(["milestones"])
    expect(clearField({ ...EMPTY_FILTER, milestones: ["m2"], labels: ["bug"] }, "milestones")).toEqual({ ...EMPTY_FILTER, labels: ["bug"] })
  })

  it("a closed milestone still matches its tasks (a link to it keeps working); an unknown name is left out", () => {
    const old = task("old", { milestoneId: "ms1" })
    expect([...all, old].filter((t) => matches(t, { ...EMPTY_FILTER, milestones: ["m1"] }, c)).map((t) => t.id)).toEqual(["old"])
    expect(shown({ milestones: ["m2", "gone"] })).toEqual(["a"])
    expect(shown({ milestones: ["gone"] })).toEqual(["a", "b", "c", "d"])
  })

  it("a project matches its own milestones; All projects matches each project's milestone of that name", () => {
    // e: THAI's task in THAI's own M2.
    const e = task("e", { projectId: "p2", milestoneId: "p2-m2" })
    const f = { ...EMPTY_FILTER, milestones: ["m2"] }
    expect([...all, e].filter((t) => matches(t, f, c)).map((t) => t.id)).toEqual(["a"])
    const everywhere = matchContext(board, { workspaceId: "w1" }, now)
    expect([...all, e].filter((t) => matches(t, f, everywhere)).map((t) => t.id)).toEqual(["a", "e"])
    expect(everywhere.milestones.get("m3")).toEqual(["ms3"])
  })

  it("milestonesInScope: a project's milestones in the order Lucas set, closed ones too", () => {
    expect(milestonesInScope(board, { projectId: "p1" }).map((m) => m.id)).toEqual(["ms1", "ms2", "ms3"])
    expect(milestonesInScope(board, { projectId: "p2" }).map((m) => m.id)).toEqual(["p2-m2"])
  })
})

describe("who's working on it: an agent, Lucas, nobody, and single sessions", () => {
  it("by kind", () => {
    expect(shown({ holder: ["agent"] })).toEqual(["b", "d"])
    expect(shown({ holder: ["human", "nobody"] })).toEqual(["a", "c"])
  })

  it("a session's claims, alone or beside a kind, ids in their own case", () => {
    expect(shown({ sessions: ["S2"] })).toEqual(["d"])
    expect(shown({ sessions: ["s2"] })).toEqual([])
    expect(shown({ sessions: ["S2"], holder: ["nobody"] })).toEqual(["a", "d"])
    expect(shown({ sessions: ["s1", "S2"] })).toEqual(["b", "d"])
    expect(countWith(all, EMPTY_FILTER, c, "holder", { holder: [], sessions: ["s1"] })).toBe(1)
    expect(clearField({ ...EMPTY_FILTER, holder: ["human"], sessions: ["S2"] }, "holder")).toEqual(EMPTY_FILTER)
    expect(activeFields({ ...EMPTY_FILTER, sessions: ["S2"] })).toEqual(["holder"])
  })
})

describe("the other facets", () => {
  it("priority, who made it, waiting on Lucas, due date, updated and text", () => {
    expect(shown({ priority: [1] })).toEqual(["a"])
    expect(shown({ maker: ["agent"] })).toEqual(["b"])
    expect(shown({ waiting: ["review"] })).toEqual(["c"])
    expect(shown({ waiting: ["input"] })).toEqual(["a"])
    expect(shown({ waiting: ["review", "input"] })).toEqual(["a", "c"])
    expect(shown({ due: ["overdue"] })).toEqual(["a"])
    expect(shown({ due: ["week"] })).toEqual(["c"])
    expect(shown({ due: ["none"] })).toEqual(["b", "d"])
    expect(shown({ updated: "day" })).toEqual(["d"])
    expect(shown({ text: "drag" })).toEqual(["c"])
    expect(shown({ text: "cel-b" })).toEqual(["b"])
  })

  it("a task still being created (number 0) always shows, whatever the filter: it's yours, and just made", () => {
    const creating = task("new", { number: 0, title: "Write the docs" })
    const f = { ...EMPTY_FILTER, labels: ["bug"], holder: ["agent" as const], text: "nothing like it" }
    expect(applyFilter([a, creating, cc], f, c).map((t) => t.id)).toEqual(["new"])
    expect(applyFilter([a, creating, cc], { ...EMPTY_FILTER, labels: ["bug"] }, c).map((t) => t.id)).toEqual(["a", "new", "c"])
  })

  it("facets combine: every active one must match, and a count leaves its own facet out", () => {
    expect(shown({ labels: ["agents"], holder: ["agent"] })).toEqual(["b"])
    const f = { ...EMPTY_FILTER, labels: ["bug"], holder: ["agent" as const] }
    expect(shown(f)).toEqual([])
    expect(countWith(all, f, c, "holder", { holder: ["human"] })).toBe(1)
    expect(countWith(all, f, c, "holder", { holder: ["nobody"] })).toBe(1)
  })
})

describe("the filter in the URL", () => {
  it("round-trips, and drops what it doesn't know", () => {
    const f = filterFromSearch({ label: "Bug,agents", milestone: "M3,none", priority: "urgent,bogus", who: "agent,martian", session: "S2,s1", waiting: "review,later", due: "overdue", updated: "day", q: "drag" })
    expect(f).toEqual({
      ...EMPTY_FILTER,
      labels: ["bug", "agents"],
      milestones: ["m3", "none"],
      priority: [1],
      holder: ["agent"],
      sessions: ["S2", "s1"],
      waiting: ["review"],
      due: ["overdue"],
      updated: "day",
      text: "drag",
    })
    expect(filterFromSearch(searchFromFilter(f) as Record<string, unknown>)).toEqual(f)
    expect(parseFilterSearch({ label: "ui", who: "martian", layout: "list" })).toEqual({ label: "ui" })
    expect(searchFromFilter({ ...EMPTY_FILTER, milestones: ["m2", "none"] }).milestone).toBe("m2,none")
    expect(searchFromFilter(EMPTY_FILTER)).toEqual(Object.fromEntries(Object.keys(searchFromFilter(f)).map((k) => [k, undefined])))
  })

  it("knows whether a search carries a filter", () => {
    expect(hasFilter(filterFromSearch({ layout: "list" }))).toBe(false)
    expect(hasFilter(filterFromSearch({ q: "  " }))).toBe(false)
    expect(hasFilter(filterFromSearch({ label: "bug" }))).toBe(true)
    expect(hasFilter(filterFromSearch({ milestone: "none" }))).toBe(true)
  })
})

describe("the filter kept on this device", () => {
  it("is stored as its search, read back the same, and empty or broken storage is no filter", () => {
    const f = { ...EMPTY_FILTER, labels: ["bug"], milestones: ["m3", "none"], sessions: ["S2"], due: ["week" as const] }
    expect(parseStoredFilter(storedFilter(f))).toEqual(f)
    expect(storedFilter(EMPTY_FILTER)).toBe("")
    expect(parseStoredFilter(null)).toEqual(EMPTY_FILTER)
    expect(parseStoredFilter("")).toEqual(EMPTY_FILTER)
    expect(parseStoredFilter("{not json")).toEqual(EMPTY_FILTER)
    expect(parseStoredFilter("[1,2]")).toEqual(EMPTY_FILTER)
  })
})
