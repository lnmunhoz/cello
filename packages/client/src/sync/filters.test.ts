import type { Actor, Label, LabelGroup, Task } from "@cello/contract/entities"
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
const label = (id: string, group: LabelGroup, workspaceId = "w1"): Label => ({
  id, workspaceId, name: id, color: "#000", group, createdAt: 0, updatedAt: 0, archivedAt: null,
})
const actor = (id: string, kind: Actor["kind"]): Actor => ({ id, kind, name: id, client: null, color: "#000", createdAt: 0 })

const board = {
  projects: { p1: { id: "p1", workspaceId: "w1" } },
  labels: {
    bug: label("bug", "kind"),
    feature: label("feature", "kind"),
    agents: label("agents", "area"),
    board: label("board", "area"),
    m2: { ...label("m2", "milestone"), name: "M2" },
    // Another workspace's label with a taken name: never this workspace's.
    other: { ...label("other", "area", "w2"), name: "bug" },
  },
  actors: { me: actor("me", "human"), claude: actor("claude", "agent") },
  reviews: { r1: { id: "r1", taskId: "c" } },
  asks: { k1: { id: "k1", taskId: "a" } },
} as unknown as BoardState
const now = new Date(2026, 10, 15, 12).getTime()
const c = matchContext(board, "w1", now)

// a: a bug in agents, urgent, overdue, waiting on Lucas's answers.
const a = task("a", { labelIds: ["bug", "agents"], priority: 1, dueDate: "2026-11-10" })
// b: a feature in agents and board, held by agent session s1, made by it.
const b = task("b", { labelIds: ["feature", "agents", "board"], assigneeActorId: "claude", assigneeSessionId: "s1", createdByActorId: "claude", createdBySessionId: "s1" })
// c: a bug on the board, in M2, held by Lucas, due this week, with a review packet.
const cc = task("c", { labelIds: ["bug", "board", "m2"], assigneeActorId: "me", dueDate: "2026-11-18", title: "Drag cards" })
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

  it("names match in any case, and a name the workspace doesn't have is left out", () => {
    expect(shown({ labels: ["BUG"] })).toEqual(["a", "c"])
    expect(shown({ labels: ["bug", "gone"] })).toEqual(["a", "c"])
    expect(shown({ labels: ["gone"] })).toEqual(["a", "b", "c", "d"])
  })

  it("an archived label stops matching", () => {
    const archived = matchContext({ ...board, labels: { ...board.labels, m2: { ...board.labels["m2"]!, archivedAt: 5 } } }, "w1", now)
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
    const f = filterFromSearch({ label: "Bug,agents", priority: "urgent,bogus", who: "agent,martian", session: "S2,s1", waiting: "review,later", due: "overdue", updated: "day", q: "drag" })
    expect(f).toEqual({
      ...EMPTY_FILTER,
      labels: ["bug", "agents"],
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
    expect(searchFromFilter(EMPTY_FILTER)).toEqual(Object.fromEntries(Object.keys(searchFromFilter(f)).map((k) => [k, undefined])))
  })

  it("knows whether a search carries a filter", () => {
    expect(hasFilter(filterFromSearch({ layout: "list" }))).toBe(false)
    expect(hasFilter(filterFromSearch({ q: "  " }))).toBe(false)
    expect(hasFilter(filterFromSearch({ label: "bug" }))).toBe(true)
  })
})

describe("the filter kept on this device", () => {
  it("is stored as its search, read back the same, and empty or broken storage is no filter", () => {
    const f = { ...EMPTY_FILTER, labels: ["bug"], sessions: ["S2"], due: ["week" as const] }
    expect(parseStoredFilter(storedFilter(f))).toEqual(f)
    expect(storedFilter(EMPTY_FILTER)).toBe("")
    expect(parseStoredFilter(null)).toEqual(EMPTY_FILTER)
    expect(parseStoredFilter("")).toEqual(EMPTY_FILTER)
    expect(parseStoredFilter("{not json")).toEqual(EMPTY_FILTER)
    expect(parseStoredFilter("[1,2]")).toEqual(EMPTY_FILTER)
  })
})
