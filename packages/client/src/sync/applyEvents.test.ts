import type { CelloEvent, EventBody } from "@cello/contract/events"
import type { DocumentSummary, Snapshot, Task } from "@cello/contract/entities"
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
  updatedByActorId: null,
  updatedBySessionId: null,
  stage: null, commentCount: 0, lastCommentAt: null,
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
  sessions: [], agents: [],
  reviews: [],
  asks: [],
  documents: [],
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

describe("applyEvents: reviews", () => {
  const review = (id: string, taskId = "t1") => ({
    id,
    taskId,
    summary: "Ready",
    steps: ["Look"],
    attachments: [],
    actorId: "agent",
    author: { name: "Claude Code", session: null },
    sessionId: null,
    createdAt: 1,
    decidedAt: null,
    decision: null,
    decisionNote: null,
  })

  it("the snapshot's open reviews load by id; a submitted one joins; a decided one leaves", () => {
    const state = fromSnapshot({ ...snapshot([task("t1")]), reviews: [review("r1")] })
    expect(Object.keys(state.reviews)).toEqual(["r1"])
    const next = applyEvents(state, [
      ev(11, { type: "review.decided", id: "r1", taskId: "t1", decision: "superseded", note: null }),
      ev(12, { type: "review.submitted", review: review("r2") }),
    ])
    expect(Object.keys(next.reviews)).toEqual(["r2"])
    expect(next.tasks).toBe(state.tasks)
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

describe("applyEvents: documents", () => {
  const doc = (id: string, version: number, extra: Partial<DocumentSummary> = {}): DocumentSummary => ({
    id, workspaceId: "w1", projectId: "p1", kind: "page", slug: id, title: `Page ${id}`, summary: "", version, tasks: [],
    createdByActorId: "a1", createdBySessionId: "s1", updatedByActorId: "a1", updatedBySessionId: "s1",
    updatedBy: { name: "Claude Code", color: "#7C3AED", session: "2fd0505c" }, createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
  })

  it("published and updated documents replace the summary; archived ones keep it with archivedAt", () => {
    const state = fromSnapshot({ ...snapshot([]), documents: [doc("d0", 1)] })
    const next = applyEvents(state, [
      ev(11, { type: "document.published", document: doc("d1", 1) }),
      ev(12, { type: "document.updated", id: "d1", version: 2, document: doc("d1", 2, { tasks: [{ id: "t1", key: "CEL-1" }] }) }),
      ev(13, { type: "document.archived", id: "d0" }),
    ])
    expect(next.documents["d1"]).toMatchObject({ version: 2, tasks: [{ id: "t1", key: "CEL-1" }] })
    expect(next.documents["d0"]).toMatchObject({ version: 1, archivedAt: 13 })
    expect(next.tasks).toBe(state.tasks)
  })
})

describe("applyEvents: stage, last change and presence (CEL-5, CEL-35)", () => {
  const agent = (seq: number, body: EventBody): CelloEvent => ({ ...ev(seq, body), actorId: "claude", sessionId: "s1" }) as CelloEvent

  it("a stage change sets the stage and version, and records who changed the task", () => {
    const state = fromSnapshot(snapshot([task("t1")]))
    const next = applyEvents(state, [agent(11, { type: "task.stage_changed", id: "t1", version: 2, before: null, after: "review" })])
    expect(next.tasks["t1"]).toMatchObject({ stage: "review", version: 2, updatedAt: 11, updatedByActorId: "claude", updatedBySessionId: "s1" })
  })

  it("every task change records its author as the last change", () => {
    const state = fromSnapshot(snapshot([task("t1")]))
    const next = applyEvents(state, [
      agent(11, { type: "task.updated", id: "t1", before: { title: "Task t1" }, after: { title: "New" }, version: 2 }),
    ])
    expect(next.tasks["t1"]).toMatchObject({ updatedByActorId: "claude", updatedBySessionId: "s1" })
    const back = applyEvents(next, [ev(12, { type: "task.labels_changed", id: "t1", added: ["bug"], removed: [], version: 3 })])
    expect(back.tasks["t1"]).toMatchObject({ updatedByActorId: "me", updatedBySessionId: null })
  })

  it("a session check-in adds or replaces the session; the snapshot's sessions load by id", () => {
    const session = {
      id: "s1", actorId: "claude", externalId: "2fd0505c-1", clientName: "Claude Code", entrypoint: null, cwd: null, pid: 1,
      startedAt: 1, lastSeenAt: 5, endedAt: null,
    }
    const state = fromSnapshot({ ...snapshot([task("t1")]), sessions: [session] })
    expect(state.sessions["s1"]?.lastSeenAt).toBe(5)
    const next = applyEvents(state, [agent(11, { type: "session.seen", session: { ...session, lastSeenAt: 11 } })])
    expect(next.sessions["s1"]?.lastSeenAt).toBe(11)
    expect(next.tasks).toBe(state.tasks)
  })

  it("a session whose agent the board doesn't know yet brings it in, named after its client, so history can name it", () => {
    const session = {
      id: "s9", actorId: "codex", externalId: "9f9f9f9f-1", clientName: "Codex", entrypoint: null, cwd: null, pid: null,
      startedAt: 1, lastSeenAt: 5, endedAt: null,
    }
    const next = applyEvents(fromSnapshot(snapshot([])), [agent(11, { type: "session.seen", session })])
    expect(next.actors["codex"]).toMatchObject({ id: "codex", kind: "agent", name: "Codex", client: "Codex" })
  })

  const comment = (id: string, at: number) => ({
    id, taskId: "t1", body: "Hi", actorId: "claude", sessionId: "s1", createdAt: at, updatedAt: at, deletedAt: null,
  })

  it("a comment is activity on its task: counted, its time is the last change, by the commenter, with the server's new version", () => {
    const state = fromSnapshot(snapshot([task("t1", { version: 3 })]))
    const added = applyEvents(state, [agent(11, { type: "comment.added", comment: comment("c1", 11) })])
    expect(added.tasks["t1"]).toMatchObject({
      commentCount: 1, lastCommentAt: 11, updatedAt: 11, updatedByActorId: "claude", updatedBySessionId: "s1", version: 4,
    })
    const edited = applyEvents(added, [ev(12, { type: "comment.edited", id: "c1", taskId: "t1", before: { body: "Hi" }, after: { body: "Hello" } })])
    expect(edited.tasks["t1"]).toMatchObject({ commentCount: 1, lastCommentAt: 12, updatedAt: 12, updatedByActorId: "me", version: 5 })
  })

  it("deleting a comment drops the count, takes the latest remaining comment's time from the event, and is a change", () => {
    const state = fromSnapshot(snapshot([task("t1", { commentCount: 2, lastCommentAt: 9, updatedAt: 9, version: 3 })]))
    const deleted = applyEvents(state, [ev(12, { type: "comment.deleted", id: "c2", taskId: "t1", lastCommentAt: 5 })])
    expect(deleted.tasks["t1"]).toMatchObject({ commentCount: 1, lastCommentAt: 5, updatedAt: 12, updatedByActorId: "me", version: 4 })
    // Deleting the only one leaves none.
    const none = applyEvents(deleted, [ev(13, { type: "comment.deleted", id: "c1", taskId: "t1", lastCommentAt: null })])
    expect(none.tasks["t1"]).toMatchObject({ commentCount: 0, lastCommentAt: null, updatedAt: 13, version: 5 })
  })

  it("an edit or delete stored before it named its task changes no task", () => {
    const state = fromSnapshot(snapshot([task("t1")]))
    const next = applyEvents(state, [ev(12, { type: "comment.deleted", id: "c1" })])
    expect(next.tasks).toBe(state.tasks)
  })

  // CEL-55: subagents under a session.
  const builder = {
    sessionId: "s1", agentId: "a13bfb89", agentType: "cello-builder", taskId: "t1", description: "CEL-1 build it",
    startedAt: 1, lastSeenAt: 5, endedAt: null,
  }
  const byBuilder = (seq: number, body: EventBody): CelloEvent => ({ ...agent(seq, body), agentId: "a13bfb89" }) as CelloEvent

  it("the snapshot's agents load by session and id; an agent check-in adds or replaces one, and two of a session both stay", () => {
    const state = fromSnapshot({ ...snapshot([task("t1")]), agents: [builder] })
    expect(state.agents["s1/a13bfb89"]?.lastSeenAt).toBe(5)
    const reviewer = { ...builder, agentId: "b77d0e11", agentType: "cello-code-reviewer", lastSeenAt: 12 }
    const next = applyEvents(state, [
      byBuilder(11, { type: "agent.seen", agent: { ...builder, lastSeenAt: 11 } }),
      agent(12, { type: "agent.seen", agent: reviewer }),
    ])
    expect(Object.keys(next.agents)).toEqual(["s1/a13bfb89", "s1/b77d0e11"])
    expect(next.agents["s1/a13bfb89"]?.lastSeenAt).toBe(11)
    expect(next.tasks).toBe(state.tasks)
  })

  it("a change or comment by an agent records it as the task's last change; the session's own change clears it", () => {
    const state = fromSnapshot(snapshot([task("t1", { version: 3 })]))
    const staged = applyEvents(state, [byBuilder(11, { type: "task.stage_changed", id: "t1", version: 4, before: null, after: "building" })])
    expect(staged.tasks["t1"]).toMatchObject({ updatedBySessionId: "s1", updatedByAgentId: "a13bfb89" })
    const commented = applyEvents(state, [byBuilder(11, { type: "comment.added", comment: { ...comment("c1", 11), agentId: "a13bfb89" } })])
    expect(commented.tasks["t1"]).toMatchObject({ updatedBySessionId: "s1", updatedByAgentId: "a13bfb89", commentCount: 1 })
    const own = applyEvents(staged, [agent(12, { type: "task.stage_changed", id: "t1", version: 5, before: "building", after: "review" })])
    expect(own.tasks["t1"]).toMatchObject({ updatedBySessionId: "s1", updatedByAgentId: null })
  })
})
