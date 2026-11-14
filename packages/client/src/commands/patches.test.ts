import type { Label, Status, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import type { BoardState } from "../sync/applyEvents.ts"
import { addLabel, addTask, archiveLabel, archiveTask, moveTask, setTaskLabels, updateLabel, updateStatus, updateTask } from "./patches.ts"

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

const label: Label = { id: "bug", workspaceId: "w1", name: "Bug", color: "#f00", createdAt: 1, updatedAt: 1, archivedAt: null }

const state: BoardState = {
  seq: 1,
  actors: {},
  workspaces: {},
  projects: {},
  statuses: { todo: status },
  labels: { bug: label },
  tasks: { t1: task("t1"), t2: task("t2") },
}

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

  it("add a task under a temporary id", () => {
    const next = addTask(task("optimistic:c1", { title: "Draft" }))(state)
    expect(next.tasks["optimistic:c1"]?.title).toBe("Draft")
  })

  it("update statuses and labels", () => {
    expect(updateStatus("todo", { name: "Next", hidden: true })(state).statuses["todo"]).toMatchObject({ name: "Next", hidden: true })
    expect(updateLabel("bug", { color: "#0f0" })(state).labels["bug"]?.color).toBe("#0f0")
    expect(archiveLabel("bug")(state).labels["bug"]?.archivedAt).not.toBeNull()
    expect(addLabel({ ...label, id: "optimistic:c2", name: "UI" })(state).labels["optimistic:c2"]?.name).toBe("UI")
  })
})
