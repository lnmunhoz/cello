import type { Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { applyEvents, fromSnapshot } from "./applyEvents.ts"
import { ORDERINGS, orderTasks, parseOrdering } from "./ordering.ts"

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number: 1, key: `CEL-${id}`, title: id, description: "", statusId: "todo", priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me",
  createdBySessionId: null, updatedByActorId: null, updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})
const ids = (tasks: ReadonlyArray<Task>) => tasks.map((t) => t.id)

// a, b, c in manual (position) order, made and changed at different times.
const a = task("a", { position: "a0", createdAt: 20, updatedAt: 50, priority: 3, dueDate: "2026-12-01" })
const b = task("b", { position: "a1", createdAt: 30, updatedAt: 40, priority: 1, dueDate: null })
const c = task("c", { position: "a2", createdAt: 10, updatedAt: 60, priority: 0, dueDate: "2026-11-20" })
const column = [c, a, b]

describe("orderTasks: the order cards show in inside a column or group", () => {
  it("manual is the drag order (position)", () => {
    expect(ids(orderTasks(column, "manual"))).toEqual(["a", "b", "c"])
  })

  it("newest first and oldest first follow when the task was made", () => {
    expect(ids(orderTasks(column, "newest"))).toEqual(["b", "a", "c"])
    expect(ids(orderTasks(column, "oldest"))).toEqual(["c", "a", "b"])
  })

  it("tasks made in the same millisecond follow their number, and one still being created is the newest", () => {
    const first = task("first", { number: 7, position: "b0", createdAt: 5 })
    const second = task("second", { number: 8, position: "a0", createdAt: 5 })
    const creating = task("creating", { number: 0, position: "c0", createdAt: 5 })
    expect(ids(orderTasks([first, creating, second], "newest"))).toEqual(["creating", "second", "first"])
    expect(ids(orderTasks([first, creating, second], "oldest"))).toEqual(["first", "second", "creating"])
  })

  it("priority puts urgent first and no priority last", () => {
    expect(ids(orderTasks(column, "priority"))).toEqual(["b", "a", "c"])
    const low = task("low", { priority: 4 })
    const high = task("high", { priority: 2 })
    expect(ids(orderTasks([low, c, high], "priority"))).toEqual(["high", "low", "c"])
  })

  it("due date puts the soonest first and tasks without one last", () => {
    expect(ids(orderTasks(column, "due"))).toEqual(["c", "a", "b"])
  })

  it("last updated puts the most recently changed first", () => {
    expect(ids(orderTasks(column, "updated"))).toEqual(["c", "a", "b"])
  })

  it("last updated counts a comment: a fresh one moves its card up", () => {
    const board = fromSnapshot({ seq: 1, actors: [], workspaces: [], projects: [], statuses: [], labels: [], tasks: column, sessions: [], agents: [], reviews: [], asks: [], documents: [] })
    const comment = { id: "k1", taskId: "b", body: "Hi", actorId: "me", sessionId: null, createdAt: 70, updatedAt: 70, deletedAt: null }
    const next = applyEvents(board, [{
      seq: 2, ts: 70, commandId: "c2", actorId: "me", sessionId: null, workspaceId: "w1", projectId: "p1", schemaVersion: 1, type: "comment.added", comment,
    }])
    expect(ids(orderTasks(Object.values(next.tasks), "updated"))).toEqual(["b", "c", "a"])
  })

  it("breaks ties with the drag order, so equal cards keep a stable order", () => {
    const x = task("x", { position: "b0", priority: 2, createdAt: 5, updatedAt: 5 })
    const y = task("y", { position: "a0", priority: 2, createdAt: 5, updatedAt: 5 })
    for (const ordering of ORDERINGS) expect(ids(orderTasks([x, y], ordering))).toEqual(["y", "x"])
  })

  it("never changes the list it was given", () => {
    const given = [b, a, c]
    orderTasks(given, "newest")
    expect(ids(given)).toEqual(["b", "a", "c"])
  })
})

describe("parseOrdering", () => {
  it("reads a known ordering and nothing else", () => {
    for (const ordering of ORDERINGS) expect(parseOrdering(ordering)).toBe(ordering)
    expect(parseOrdering("alphabetical")).toBeNull()
    expect(parseOrdering(null)).toBeNull()
    expect(parseOrdering(3)).toBeNull()
  })
})
