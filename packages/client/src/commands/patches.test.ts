import type { Label, Status, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import type { BoardState } from "../sync/applyEvents.ts"
import { addLabel, addMilestone, addTask, archiveLabel, archiveTask, moveTask, setTaskLabels, setTaskMilestone, updateLabel, updateStatus, updateTask } from "./patches.ts"

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  projectId: "p1",
  number: 1,
  key: "CEL-1",
  title: id,
  description: "",
  statusId: "todo",
  priority: 0,
  position: "a0",
  dueDate: null,
  parentId: null,
  labelIds: [],
  assigneeActorId: null,
  assigneeSessionId: null,
  createdByActorId: "me",
  createdBySessionId: null,
  updatedByActorId: null,
  updatedBySessionId: null,
  stage: null, commentCount: 0, lastCommentAt: null,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  ...overrides,
})

const status: Status = {
  id: "todo",
  workspaceId: "w1",
  name: "Todo",
  category: "unstarted",
  position: "a0",
  color: "#999",
  hidden: false,
  createdAt: 1,
  updatedAt: 1,
}

const label: Label = { id: "bug", workspaceId: "w1", projectId: "p1", name: "Bug", color: "#f00", group: "kind", createdAt: 1, updatedAt: 1, archivedAt: null }

const state: BoardState = {
  seq: 1,
  actors: {},
  workspaces: {},
  projects: { p1: { id: "p1", workspaceId: "w1" } as BoardState["projects"][string] },
  statuses: { todo: status },
  labels: { bug: label },
  milestones: {},
  tasks: { t1: task("t1"), t2: task("t2") },
  sessions: {}, agents: {},
  reviews: {},
  asks: {},
  documents: {}, wakes: {},
}

describe("milestone patches (CEL-113)", () => {
  it("puts a task in a milestone with its version bumped, takes it out, and adds a milestone to a loaded project only", () => {
    const inM3 = setTaskMilestone("t1", "m3")(state)
    expect(inM3.tasks["t1"]).toMatchObject({ milestoneId: "m3", version: 2 })
    expect(inM3.tasks["t2"]).toBe(state.tasks["t2"])
    expect(setTaskMilestone("t1", null)(inM3).tasks["t1"]!.milestoneId).toBeNull()
    const m3 = { id: "m3", projectId: "p1", name: "M3", goal: "", targetDate: null, position: "a0", state: "open" as const, closedAt: null, createdAt: 1, updatedAt: 1 }
    expect(addMilestone(m3)(state).milestones["m3"]).toEqual(m3)
    expect(addMilestone({ ...m3, projectId: "elsewhere" })(state)).toBe(state)
  })
})

describe("patches", () => {
  it("move a task and keep other rows as the same objects", () => {
    const next = moveTask("t1", "done", "b0")(state)
    expect(next.tasks["t1"]).toMatchObject({ statusId: "done", position: "b0" })
    expect(next.tasks["t2"]).toBe(state.tasks["t2"])
    expect(next.statuses).toBe(state.statuses)
  })

  it("leave the state alone when the row is gone", () => {
    expect(moveTask("nope", "done", "b0")(state)).toBe(state)
    expect(updateTask("nope", { title: "x" })(state)).toBe(state)
  })

  it("update, label and archive tasks", () => {
    expect(updateTask("t1", { title: "New", priority: 2 })(state).tasks["t1"]).toMatchObject({ title: "New", priority: 2 })
    expect(setTaskLabels("t1", ["bug", "ui"], [])(state).tasks["t1"]?.labelIds).toEqual(["bug", "ui"])
    const labelled = setTaskLabels("t1", ["bug"], [])(state)
    expect(setTaskLabels("t1", [], ["bug"])(labelled).tasks["t1"]?.labelIds).toEqual([])
    expect(archiveTask("t1")(state).tasks["t1"]?.archivedAt).not.toBeNull()
  })

  it("bump a task's version the way the server will, so the next edit from this tab expects the right one", () => {
    expect(updateTask("t1", { priority: 2 })(state).tasks["t1"]?.version).toBe(2)
    expect(moveTask("t1", "done", "b0")(state).tasks["t1"]?.version).toBe(2)
    expect(setTaskLabels("t1", ["bug"], [])(state).tasks["t1"]?.version).toBe(2)
    expect(archiveTask("t1")(state).tasks["t1"]?.version).toBe(2)
    expect(updateTask("t1", { dueDate: "2026-12-01" })(updateTask("t1", { priority: 2 })(state)).tasks["t1"]?.version).toBe(3)
  })

  it("mark a changed task as updated now, so Last updated ordering moves it at once", () => {
    for (const change of [moveTask("t1", "done", "b0"), updateTask("t1", { priority: 2 }), setTaskLabels("t1", ["bug"], [])]) {
      expect(change(state).tasks["t1"]!.updatedAt).toBeGreaterThan(1)
    }
  })

  it("add a task under a temporary id", () => {
    const next = addTask(task("optimistic:c1", { title: "Draft" }))(state)
    expect(next.tasks["optimistic:c1"]?.title).toBe("Draft")
  })

  it("update statuses and labels", () => {
    expect(updateStatus("todo", { name: "Next", hidden: true })(state).statuses["todo"]).toMatchObject({ name: "Next", hidden: true })
    expect(updateLabel("bug", { color: "#0f0" })(state).labels["bug"]?.color).toBe("#0f0")
    expect(archiveLabel("bug")(state).labels["bug"]?.archivedAt).not.toBeNull()
    const { workspaceId: _, ...fields } = label
    expect(addLabel({ ...fields, id: "optimistic:c2", name: "UI" })(state).labels["optimistic:c2"]).toMatchObject({ name: "UI", projectId: "p1", workspaceId: "w1" })
    // A project the tab hasn't loaded: nothing to show it in.
    expect(addLabel({ ...fields, id: "optimistic:c3", projectId: "nope" })(state)).toBe(state)
  })
})
