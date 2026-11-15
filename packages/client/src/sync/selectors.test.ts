import type { Project, Status, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import type { BoardState } from "./applyEvents.ts"
import { boardColumns, byPosition, placement, placementAtEnd, projectsOf, taskByKey, taskFinder } from "./selectors.ts"

const status = (id: string, position: string, hidden = false): Status => ({
  id, workspaceId: "w1", name: id, category: "unstarted", position, color: "#999", hidden, createdAt: 1, updatedAt: 1,
})
const task = (id: string, statusId: string, position: string, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number: 1, key: "CEL-1", title: id, description: "", statusId, priority: 0, position,
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me",
  createdBySessionId: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})
const project = (id: string, key: string, name: string, extra: Partial<Project> = {}): Project => ({
  id, workspaceId: "w1", name, key, color: "#000", description: "", repoPath: null, createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})

const state: BoardState = {
  seq: 1,
  actors: {},
  workspaces: {},
  projects: { p1: project("p1", "CEL", "Cello"), p2: project("p2", "ZED", "Zed"), p3: project("p3", "OLD", "Old", { archivedAt: 5 }) },
  statuses: { done: status("done", "c0"), todo: status("todo", "a0"), back: status("back", "0a", true) },
  labels: {},
  tasks: {
    t2: task("t2", "todo", "a2"),
    t1: task("t1", "todo", "a0"),
    t3: task("t3", "done", "a0"),
    gone: task("gone", "todo", "a5", { archivedAt: 9 }),
    other: task("other", "todo", "a1", { projectId: "p2", key: "ZED-4", number: 4 }),
  },
  reviews: {},
  documents: {},
}

describe("selectors", () => {
  it("sorts by position", () => {
    expect(byPosition([{ position: "b" }, { position: "a" }])).toEqual([{ position: "a" }, { position: "b" }])
  })

  it("builds columns from visible statuses, with hidden ones apart and archived tasks left out", () => {
    const board = boardColumns(state, "w1", "p1")
    expect(board.visible.map((s) => s.id)).toEqual(["todo", "done"])
    expect(board.hidden.map((s) => s.id)).toEqual(["back"])
    expect(board.tasks["todo"]?.map((t) => t.id)).toEqual(["t1", "t2"])
    expect(board.tasks["done"]?.map((t) => t.id)).toEqual(["t3"])
    expect(board.tasks["back"]).toEqual([])
  })

  it("places an item between its new neighbors", () => {
    const column = byPosition([state.tasks["t1"]!, state.tasks["t2"]!])
    expect(placement(column, 0)).toMatchObject({ before: null, after: "t1" })
    expect(placement(column, 1)).toMatchObject({ before: "t1", after: "t2" })
    expect(placement(column, 2)).toMatchObject({ before: "t2", after: null })
    const mid = placement(column, 1).position
    expect(mid > "a0" && mid < "a2").toBe(true)
    expect(placement([], 0)).toMatchObject({ before: null, after: null })
  })

  it("places a new item last, naming no neighbor so the server appends it", () => {
    const column = byPosition([state.tasks["t1"]!, state.tasks["t2"]!])
    const end = placementAtEnd(column)
    expect(end).toMatchObject({ before: null, after: null })
    expect(end.position > "a2").toBe(true)
    expect(placementAtEnd([])).toMatchObject({ before: null, after: null })
    // A card still being created has a temporary id the server doesn't know; the next one still lands after it.
    const creating = { ...state.tasks["t2"]!, id: "optimistic:c1", position: end.position }
    const next = placementAtEnd([...column, creating])
    expect(next).toMatchObject({ before: null, after: null })
    expect(next.position > end.position).toBe(true)
  })

  it("lists a workspace's open projects by name and finds a task by key", () => {
    expect(projectsOf(state, "w1").map((p) => p.key)).toEqual(["CEL", "ZED"])
    expect(taskByKey(state, "ZED", 4)?.id).toBe("other")
    expect(taskByKey(state, "zed", 4)?.id).toBe("other")
    expect(taskByKey(state, "CEL", 99)).toBeUndefined()
  })

  it("finds a task and its status by its whole key, for task keys in rendered text", () => {
    const find = taskFinder(state)
    expect(find("ZED-4")).toEqual({ task: state.tasks["other"], status: state.statuses["todo"] })
    expect(find("ZED-5")).toBeUndefined()
    expect(find("NOPE-1")).toBeUndefined()
    expect(find("not a key")).toBeUndefined()
  })
})
