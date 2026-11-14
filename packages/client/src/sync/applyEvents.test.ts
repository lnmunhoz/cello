import type { CelloEvent, EventBody } from "@cello/contract/events"
import type { Snapshot, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { applyEvents, fromSnapshot } from "./applyEvents.ts"

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  projectId: "p1",
  number: 1,
  key: "CEL-1",
  title: `Task ${id}`,
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

const snapshot = (tasks: Task[], seq = 10): Snapshot => ({
  seq,
  actors: [],
  workspaces: [],
  projects: [],
  statuses: [],
  labels: [],
  tasks,
  reviews: [],
})

const ev = (seq: number, body: EventBody): CelloEvent =>
  ({
    seq,
    ts: seq,
    commandId: `c${seq}`,
    actorId: "me",
    sessionId: null,
    workspaceId: "w1",
    projectId: "p1",
    schemaVersion: 1,
    ...body,
  }) as CelloEvent

describe("applyEvents", () => {
  it("ignores events at or below the state's seq", () => {
    const state = fromSnapshot(snapshot([task("t1")], 10))
    const next = applyEvents(state, [ev(9, { type: "task.created", task: task("old") }), ev(10, { type: "task.archived", id: "t1", version: 2 })])
    expect(next).toBe(state)
  })

  it("applies events after the seq and advances it", () => {
    const state = fromSnapshot(snapshot([], 10))
    const next = applyEvents(state, [ev(11, { type: "task.created", task: task("t1") })])
    expect(next.seq).toBe(11)
    expect(next.tasks["t1"]?.title).toBe("Task t1")
  })

  it("keeps unchanged rows as the same objects", () => {
    const state = fromSnapshot(snapshot([task("t1"), task("t2")]))
    const next = applyEvents(state, [ev(11, { type: "task.updated", id: "t2", before: { title: "Task t2" }, after: { title: "Renamed" }, version: 2 })])
    expect(next.tasks["t1"]).toBe(state.tasks["t1"])
    expect(next.tasks["t2"]).not.toBe(state.tasks["t2"])
    expect(next.tasks["t2"]?.title).toBe("Renamed")
    expect(next.tasks["t2"]?.version).toBe(2)
    expect(next.projects).toBe(state.projects)
  })

  it("applies a batch in order", () => {
    const state = fromSnapshot(snapshot([]))
    const moved = task("t1", { statusId: "done", position: "b0", version: 2 })
    const next = applyEvents(state, [
      ev(11, { type: "task.created", task: task("t1") }),
      ev(12, { type: "task.moved", id: "t1", from: { statusId: "todo", position: "a0" }, to: { statusId: "done", position: "b0" }, version: 2, task: moved }),
      ev(13, { type: "task.labels_changed", id: "t1", added: ["bug"], removed: [], version: 3 }),
    ])
    expect(next.seq).toBe(13)
    expect(next.tasks["t1"]).toMatchObject({ statusId: "done", position: "b0", labelIds: ["bug"], version: 3 })
  })

  it("archives and unarchives tasks", () => {
    const state = fromSnapshot(snapshot([task("t1")]))
    const archived = applyEvents(state, [ev(11, { type: "task.archived", id: "t1", version: 2 })])
    expect(archived.tasks["t1"]?.archivedAt).not.toBeNull()
    const back = applyEvents(archived, [ev(12, { type: "task.unarchived", id: "t1", version: 3 })])
    expect(back.tasks["t1"]?.archivedAt).toBeNull()
  })
})

describe("applyEvents: claims", () => {
  it("claimed, taken and released events replace the task; claim_ended clears the assignee", () => {
    const state = fromSnapshot(snapshot([task("t1")]))
    const claimed = task("t1", { assigneeActorId: "a1", assigneeSessionId: "s1", statusId: "doing", version: 2 })
    const taken = task("t1", { assigneeActorId: "a1", assigneeSessionId: "s2", statusId: "doing", version: 3 })
    const released = task("t1", { assigneeActorId: null, assigneeSessionId: null, statusId: "doing", version: 4 })

    const afterClaim = applyEvents(state, [ev(11, { type: "task.claimed", id: "t1", version: 2, task: claimed })])
    expect(afterClaim.tasks["t1"]).toEqual(claimed)
    const afterTake = applyEvents(afterClaim, [
      ev(12, { type: "task.claim_taken", id: "t1", version: 3, task: taken, from: { actorId: "a1", sessionId: "s1" }, reason: "holder_exited" }),
    ])
    expect(afterTake.tasks["t1"]).toEqual(taken)
    expect(applyEvents(afterTake, [ev(13, { type: "task.released", id: "t1", version: 4, task: released })]).tasks["t1"]).toEqual(released)

    const ended = applyEvents(afterTake, [
      ev(13, { type: "task.claim_ended", id: "t1", version: 4, from: { actorId: "a1", sessionId: "s2" }, reason: "human_change" }),
    ]).tasks["t1"]!
    expect(ended).toMatchObject({ assigneeActorId: null, assigneeSessionId: null, version: 4 })
  })
})
