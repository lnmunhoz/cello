import type { Comment, Task } from "@cello/contract/entities"
import type { CelloEvent, EventBody } from "@cello/contract/events"
import { describe, expect, it } from "vitest"
import { changeOf, excerpt } from "./steps.ts"

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
  createdByActorId: "agent",
  createdBySessionId: "s1",
  updatedByActorId: null,
  updatedBySessionId: null,
  stage: null, commentCount: 0, lastCommentAt: null,
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  ...overrides,
})

const comment = (body: string): Comment => ({ id: "c1", taskId: "t1", body, actorId: "agent", sessionId: "s1", createdAt: 1, updatedAt: 1, deletedAt: null })

/** An event from agent session s1 in project p1, unless overridden. */
const ev = (body: EventBody, envelope: Partial<CelloEvent> = {}): CelloEvent =>
  ({
    seq: 1,
    ts: 1,
    commandId: "cmd",
    actorId: "agent",
    sessionId: "s1",
    workspaceId: "w1",
    projectId: "p1",
    schemaVersion: 1,
    ...body,
    ...envelope,
  }) as CelloEvent

const nowhere = () => undefined
const at = (statusId: string, position = "a0") => () => ({ statusId, position })

describe("changeOf", () => {
  it("shows nothing for Lucas's own changes, from this tab or another: they have no agent session", () => {
    expect(changeOf(ev({ type: "task.moved", id: "t1", from: { statusId: "todo", position: "a0" }, to: { statusId: "done", position: "a0" }, version: 2, task: task("t1") }, { sessionId: null }), "p1", nowhere)).toBeNull()
  })

  it("shows nothing for another project's changes", () => {
    expect(changeOf(ev({ type: "task.created", task: task("t1") }, { projectId: "p2" }), "p1", nowhere)).toBeNull()
  })

  it("names the kind of change and the card", () => {
    const moved = ev({ type: "task.moved", id: "t1", from: { statusId: "todo", position: "a0" }, to: { statusId: "done", position: "a0" }, version: 2, task: task("t1") })
    expect(changeOf(moved, "p1", nowhere)).toEqual({ lane: "s1", actorId: "agent", card: "t1", kind: "move", note: null })
    expect(changeOf(ev({ type: "task.created", task: task("t2") }), "p1", nowhere)).toMatchObject({ card: "t2", kind: "create" })
    expect(changeOf(ev({ type: "task.updated", id: "t1", before: { title: "Old" }, after: { title: "New" }, version: 3 }), "p1", nowhere)).toMatchObject({
      kind: "title",
    })
    expect(changeOf(ev({ type: "task.updated", id: "t1", before: { priority: 0 }, after: { priority: 2 }, version: 3 }), "p1", nowhere)).toMatchObject({
      kind: "field",
    })
    expect(changeOf(ev({ type: "task.labels_changed", id: "t1", added: ["l1"], removed: [], version: 3 }), "p1", nowhere)).toMatchObject({ kind: "field" })
  })

  it("a comment pops a bubble with the start of its text", () => {
    expect(changeOf(ev({ type: "comment.added", comment: comment("Done: the queue plays in order.\n\nDetails below") }), "p1", nowhere)).toEqual({
      lane: "s1",
      actorId: "agent",
      card: "t1",
      kind: "comment",
      note: "Done: the queue plays in order.",
    })
  })

  it("a claim that moves the card to a started column flies like a move, with a Claimed bubble", () => {
    const claimed = ev({ type: "task.claimed", id: "t1", version: 3, task: task("t1", { statusId: "doing" }) })
    expect(changeOf(claimed, "p1", at("todo"))).toMatchObject({ kind: "move", note: "Claimed" })
    expect(changeOf(claimed, "p1", at("doing"))).toMatchObject({ kind: "claim", note: "Claimed" })
    // A card the board didn't show before can't fly; it gets the bubble.
    expect(changeOf(claimed, "p1", nowhere)).toMatchObject({ kind: "claim", note: "Claimed" })
  })

  it("names a takeover and a release", () => {
    const from = { actorId: "agent", sessionId: "s0" }
    expect(changeOf(ev({ type: "task.claim_taken", id: "t1", version: 3, task: task("t1"), from, reason: "holder_idle" }), "p1", at("todo"))).toMatchObject({
      kind: "claim",
      note: "Took over",
    })
    expect(changeOf(ev({ type: "task.released", id: "t1", version: 3, task: task("t1") }), "p1", at("todo"))).toMatchObject({ kind: "claim", note: "Released" })
  })

  it("ignores events the board doesn't animate", () => {
    expect(changeOf(ev({ type: "task.archived", id: "t1", version: 3 }), "p1", nowhere)).toBeNull()
    expect(changeOf(ev({ type: "label.archived", id: "l1" }), "p1", nowhere)).toBeNull()
  })
})

describe("excerpt", () => {
  it("keeps the first line, without markdown marks, cut at a word near 60 characters", () => {
    expect(excerpt("**Shipped** the `queue`")).toBe("Shipped the queue")
    expect(excerpt("# Title\nbody")).toBe("Title")
    expect(excerpt("word ".repeat(30))).toBe(`${"word ".repeat(12).trim()}…`)
    expect(excerpt("\n\n  \nSecond")).toBe("Second")
  })
})
