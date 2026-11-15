import type { Label, Status, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import type { BoardState } from "./applyEvents.ts"
import { labelsOf, listGroups, parentOf } from "./list.ts"

const status = (id: string, position: string, hidden = false): Status => ({
  id, workspaceId: "w1", name: id, category: "unstarted", position, color: "#999", hidden, createdAt: 1, updatedAt: 1,
})
const task = (id: string, statusId: string, position: string, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number: 1, key: "CEL-1", title: id, description: "", statusId, priority: 0, position,
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me",
  createdBySessionId: null, updatedByActorId: null, updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})

const label = (id: string, archivedAt: number | null = null): Label => ({
  id, workspaceId: "w1", name: id, color: "#e5484d", group: "none", archivedAt, createdAt: 1, updatedAt: 1,
})

const state: BoardState = {
  seq: 1,
  actors: {},
  workspaces: {},
  projects: {},
  statuses: {
    done: status("done", "c0"),
    canceled: status("canceled", "d0", true),
    todo: status("todo", "a0"),
    back: status("back", "0a", true),
    review: status("review", "b0"),
    elsewhere: { ...status("elsewhere", "a5"), workspaceId: "w2" },
  },
  labels: { bug: label("bug"), ui: label("ui"), old: label("old", 7) },
  tasks: {
    t2: task("t2", "todo", "a2", { parentId: "t3" }),
    t1: task("t1", "todo", "a0"),
    t3: task("t3", "done", "a0"),
    t4: task("t4", "back", "a0", { parentId: "gone" }),
    gone: task("gone", "todo", "a5", { archivedAt: 9 }),
    other: task("other", "todo", "a1", { projectId: "p2" }),
    orphan: task("orphan", "todo", "a3", { parentId: "missing" }),
  },
  sessions: {},
  reviews: {},
  asks: {},
  documents: {},
}

describe("listGroups", () => {
  it("gives one group per status: visible ones in status order, then the hidden ones", () => {
    expect(listGroups(state, "w1", "p1").map((g) => g.status.id)).toEqual(["todo", "review", "done", "back", "canceled"])
  })

  it("holds each status's open tasks of this project in position order, and keeps empty groups", () => {
    const groups = Object.fromEntries(listGroups(state, "w1", "p1").map((g) => [g.status.id, g.tasks.map((t) => t.id)]))
    expect(groups).toEqual({ todo: ["t1", "t2", "orphan"], review: [], done: ["t3"], back: ["t4"], canceled: [] })
  })

  it("folds Needs input into the first started group while its column is off, and shows it as a group when on", () => {
    const withInput: BoardState = {
      ...state,
      statuses: {
        ...state.statuses,
        doing: { ...status("doing", "a5"), name: "In Progress", category: "started" },
        input: { ...status("input", "a7"), name: "Needs input", category: "waiting" },
      },
      tasks: { ...state.tasks, w1: task("w1", "input", "a0"), d1: task("d1", "doing", "a0") },
    }
    const off = listGroups(withInput, "w1", "p1", { needsInputColumn: false })
    expect(off.map((g) => [g.status.id, g.tasks.map((t) => t.id)])).toEqual([
      ["todo", ["t1", "t2", "orphan"]], ["doing", ["d1", "w1"]], ["review", []], ["done", ["t3"]], ["back", ["t4"]], ["canceled", []],
    ])
    expect(listGroups(withInput, "w1", "p1", { needsInputColumn: true }).map((g) => g.status.id)).toContain("input")
  })
})

describe("parentOf", () => {
  it("finds the parent task for the breadcrumb", () => {
    expect(parentOf(state, state.tasks["t2"]!)?.id).toBe("t3")
  })

  it("gives nothing without a parent, for an archived parent, or for one not loaded", () => {
    expect(parentOf(state, state.tasks["t1"]!)).toBeUndefined()
    expect(parentOf(state, state.tasks["t4"]!)).toBeUndefined()
    expect(parentOf(state, state.tasks["orphan"]!)).toBeUndefined()
  })
})

describe("labelsOf", () => {
  it("gives the task's labels in its order, leaving out archived and unknown ones", () => {
    const tagged = { ...state.tasks["t1"]!, labelIds: ["ui", "old", "nope", "bug"] }
    expect(labelsOf(state, tagged).map((l) => l.id)).toEqual(["ui", "bug"])
    expect(labelsOf(state, state.tasks["t1"]!)).toEqual([])
  })
})
