import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"
import { CelloEvent, decodeEvent, StreamedEvent, UnknownSchemaVersion } from "./events.ts"

const envelope = {
  seq: 7,
  ts: 1_700_000_000_000,
  commandId: "cmd-1",
  actorId: "actor-1",
  sessionId: null,
  workspaceId: "ws-1",
  projectId: "p-1",
}

describe("decodeEvent", () => {
  it("decodes a v1 event", () => {
    const event = decodeEvent({
      ...envelope,
      schemaVersion: 1,
      type: "task.updated",
      id: "t-1",
      before: { title: "Old" },
      after: { title: "New" },
      version: 2,
    })
    expect(event.type).toBe("task.updated")
    if (event.type === "task.updated") expect(event.after.title).toBe("New")
  })

  it("reads a task stored before CEL-5/35 with no stage and no last change as null", () => {
    const task = {
      id: "t-1", projectId: "p-1", number: 1, key: "CEL-1", title: "Old", description: "", statusId: "s-1", priority: 0,
      position: "a0", dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null,
      createdByActorId: "actor-1", createdBySessionId: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null,
    }
    const event = decodeEvent({ ...envelope, schemaVersion: 1, type: "task.created", task })
    if (event.type !== "task.created") throw new Error(event.type)
    expect(event.task).toMatchObject({ stage: null, updatedByActorId: null, updatedBySessionId: null, commentCount: 0, lastCommentAt: null })
  })

  it("leaves a task stored before milestones (CEL-113) without one, and decodes the milestone events", () => {
    const task = {
      id: "t-1", projectId: "p-1", number: 1, key: "CEL-1", title: "Old", description: "", statusId: "s-1", priority: 0,
      position: "a0", dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null,
      createdByActorId: "actor-1", createdBySessionId: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null,
    }
    const created = decodeEvent({ ...envelope, schemaVersion: 1, type: "task.created", task })
    expect(created.type === "task.created" && created.task.milestoneId).toBeUndefined()
    const milestone = { id: "m-1", projectId: "p-1", name: "M3", goal: "", targetDate: "2026-12-01", position: "a0", state: "open", closedAt: null, createdAt: 1, updatedAt: 1 }
    expect(decodeEvent({ ...envelope, schemaVersion: 1, type: "milestone.created", milestone }).type).toBe("milestone.created")
    const updated = decodeEvent({ ...envelope, schemaVersion: 1, type: "milestone.updated", id: "m-1", before: { targetDate: null }, after: { targetDate: "2026-12-01" } })
    expect(updated.type === "milestone.updated" && updated.after).toEqual({ targetDate: "2026-12-01" })
    const changed = decodeEvent({ ...envelope, schemaVersion: 1, type: "task.milestone_changed", id: "t-1", version: 2, before: null, after: "m-1", fromLabels: ["M3", "M2"] })
    expect(changed.type === "task.milestone_changed" && changed.fromLabels).toEqual(["M3", "M2"])
    expect(() => decodeEvent({ ...envelope, schemaVersion: 1, type: "milestone.created", milestone: { ...milestone, state: "done" } })).toThrow()
  })

  it("reads the stage `designing`, stored while it existed (CEL-105), as `planning`, its new name", () => {
    const changed = decodeEvent({ ...envelope, schemaVersion: 1, type: "task.stage_changed", id: "t-1", version: 3, before: "designing", after: "designing" })
    expect(changed.type === "task.stage_changed" && [changed.before, changed.after]).toEqual(["planning", "planning"])
    const task = {
      id: "t-1", projectId: "p-1", number: 1, key: "CEL-1", title: "Old", description: "", statusId: "s-1", priority: 0,
      position: "a0", dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null,
      createdByActorId: "actor-1", createdBySessionId: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null, stage: "designing",
    }
    const claimed = decodeEvent({ ...envelope, schemaVersion: 1, type: "task.claimed", id: "t-1", version: 2, task })
    expect(claimed.type === "task.claimed" && claimed.task.stage).toBe("planning")
  })

  it("comment edits and deletes name their task; ones stored before they did still decode", () => {
    const edited = decodeEvent({ ...envelope, schemaVersion: 1, type: "comment.edited", id: "c-1", taskId: "t-1", before: { body: "a" }, after: { body: "b" } })
    expect(edited.type === "comment.edited" && edited.taskId).toBe("t-1")
    const old = decodeEvent({ ...envelope, schemaVersion: 1, type: "comment.deleted", id: "c-1" })
    expect(old.type === "comment.deleted" && old.taskId).toBeUndefined()
  })

  it("reads a label stored before CEL-52 as in no group, and decodes a group change; an unknown group is refused", () => {
    const label = { id: "l-1", workspaceId: "ws-1", name: "bug", color: "#EF4444", createdAt: 1, updatedAt: 1, archivedAt: null }
    const created = decodeEvent({ ...envelope, schemaVersion: 1, type: "label.created", label })
    expect(created.type === "label.created" && created.label.group).toBe("none")
    const moved = decodeEvent({ ...envelope, schemaVersion: 1, type: "label.updated", id: "l-1", before: { group: "none" }, after: { group: "kind" } })
    expect(moved.type === "label.updated" && moved.after.group).toBe("kind")
    expect(() =>
      decodeEvent({ ...envelope, schemaVersion: 1, type: "label.updated", id: "l-1", before: { group: "none" }, after: { group: "theme" } })
    ).toThrow()
  })

  it("reads a label stored before CEL-80 as in no project, and keeps the project of one stored after", () => {
    const label = { id: "l-1", workspaceId: "ws-1", name: "bug", color: "#EF4444", group: "kind", createdAt: 1, updatedAt: 1, archivedAt: null }
    const old = decodeEvent({ ...envelope, schemaVersion: 1, type: "label.created", label })
    expect(old.type === "label.created" && old.label.projectId).toBe("")
    const now = decodeEvent({ ...envelope, schemaVersion: 1, type: "label.created", label: { ...label, projectId: "p-1" } })
    expect(now.type === "label.created" && now.label.projectId).toBe("p-1")
  })

  it("decodes a stage change and a session check-in, and refuses a stage that isn't in the list", () => {
    const changed = decodeEvent({ ...envelope, schemaVersion: 1, type: "task.stage_changed", id: "t-1", version: 3, before: null, after: "review" })
    expect(changed.type === "task.stage_changed" && changed.after).toBe("review")
    expect(() =>
      decodeEvent({ ...envelope, schemaVersion: 1, type: "task.stage_changed", id: "t-1", version: 3, before: null, after: "deploying" })
    ).toThrow()
    const session = {
      id: "s-1", actorId: "actor-2", externalId: "2fd0505c-aaaa", clientName: "Claude Code", entrypoint: "cli", cwd: "/repo",
      pid: 42, startedAt: 1, lastSeenAt: 2, endedAt: null,
    }
    const seen = decodeEvent({ ...envelope, projectId: null, schemaVersion: 1, type: "session.seen", session })
    expect(seen.type === "session.seen" && seen.session.lastSeenAt).toBe(2)
  })

  it("decodes a submitted review with its attachments, and a decision", () => {
    const attachment = {
      id: "a-1",
      taskId: "t-1",
      reviewId: "r-1",
      kind: "video",
      name: "demo.mp4",
      url: null,
      caption: "The flow",
      mime: "video/mp4",
      bytes: 1024,
      hasPoster: true,
      actorId: "actor-1",
      sessionId: null,
      createdAt: 1,
      deletedAt: null,
    }
    const review = {
      id: "r-1",
      taskId: "t-1",
      summary: "Adds **review packets**",
      steps: ["Open /review", "Approve"],
      attachments: [attachment],
      actorId: "actor-1",
      author: { name: "Claude Code", session: "2fd0505c" },
      sessionId: null,
      createdAt: 1,
      decidedAt: null,
      decision: null,
      decisionNote: null,
    }
    const submitted = decodeEvent({ ...envelope, schemaVersion: 1, type: "review.submitted", review })
    expect(submitted.type === "review.submitted" && submitted.review.attachments[0]?.kind).toBe("video")
    // Stored before asks existed (CEL-47): the attachment has no askId, and decodes with null.
    expect(submitted.type === "review.submitted" && submitted.review.attachments[0]?.askId).toBeNull()
    const decided = decodeEvent({ ...envelope, schemaVersion: 1, type: "review.decided", id: "r-1", taskId: "t-1", decision: "sent_back", note: "Fix the poster" })
    expect(decided).toMatchObject({ decision: "sent_back", note: "Fix the poster" })
    expect(() => decodeEvent({ ...envelope, schemaVersion: 1, type: "review.decided", id: "r-1", taskId: "t-1", decision: "maybe", note: null })).toThrow()
    // An approval passed on from chat (CEL-169) says which session relayed it; older events, and the human's own, don't.
    expect(decided).not.toHaveProperty("relayedBy")
    const relayed = decodeEvent({
      ...envelope, schemaVersion: 1, type: "review.decided", id: "r-1", taskId: "t-1", decision: "approved", note: "Approved, commit",
      relayedBy: { name: "Claude Code", session: "3fd1f460" },
    })
    expect(relayed).toMatchObject({ decision: "approved", relayedBy: { name: "Claude Code", session: "3fd1f460" } })
    expect(decodeEvent({ ...envelope, schemaVersion: 1, type: "review.submitted", review: { ...review, decision: "approved", decidedAt: 2, relayedBy: { name: "Claude Code", session: "3fd1f460" } } }))
      .toMatchObject({ review: { relayedBy: { session: "3fd1f460" } } })
    expect(submitted.type === "review.submitted" && submitted.review).not.toHaveProperty("relayedBy")
    // A plain move out of In Review closes the packet undecided (CEL-71), saying where the task went.
    const withdrawn = decodeEvent({ ...envelope, schemaVersion: 1, type: "review.withdrawn", id: "r-1", taskId: "t-1", to: "s-progress" })
    expect(withdrawn).toMatchObject({ type: "review.withdrawn", id: "r-1", taskId: "t-1", to: "s-progress" })
    expect(decodeEvent({ ...envelope, schemaVersion: 1, type: "review.submitted", review: { ...review, decision: "withdrawn", decidedAt: 2 } }))
      .toMatchObject({ review: { decision: "withdrawn" } })
  })

  it("decodes document events, which carry the document without its body", () => {
    const document = {
      id: "d-1",
      workspaceId: "ws-1",
      projectId: "p-1",
      kind: "page",
      slug: "billing-audit",
      title: "Billing audit",
      summary: "What we found",
      version: 2,
      tasks: [{ id: "t-1", key: "CEL-12" }],
      createdByActorId: "actor-1",
      createdBySessionId: null,
      updatedByActorId: "actor-1",
      updatedBySessionId: null,
      updatedBy: { name: "Claude Code", color: "#7C3AED", session: "2fd0505c" },
      createdAt: 1,
      updatedAt: 2,
      archivedAt: null,
    }
    const updated = decodeEvent({ ...envelope, schemaVersion: 1, type: "document.updated", id: "d-1", version: 2, document })
    expect(updated.type === "document.updated" && updated.document.tasks[0]?.key).toBe("CEL-12")
    expect(decodeEvent({ ...envelope, schemaVersion: 1, type: "document.archived", id: "d-1" }).type).toBe("document.archived")
    expect(() => decodeEvent({ ...envelope, schemaVersion: 1, type: "document.published", document: { ...document, kind: "memo" } })).toThrow()
  })

  it("decodes asks: created with questions, answered with the answers, withdrawn with a reason", () => {
    const ask = {
      id: "k-1",
      taskId: "t-1",
      title: "Search layout",
      intro: "",
      questions: [{ id: "q1", prompt: "Which?", kind: "one", options: [{ id: "q1o1", label: "Peek", description: "", imageId: null, recommended: true, because: "Long text" }] }],
      attachments: [],
      actorId: "actor-1",
      sessionId: "s-1",
      author: { name: "Claude Code", session: "2fd0505c" },
      state: "open",
      createdAt: 1,
      answeredAt: null,
      answers: null,
      withdrawnAt: null,
      withdrawnBy: null,
    }
    expect(decodeEvent({ ...envelope, schemaVersion: 1, type: "ask.created", ask })).toMatchObject({ ask: { questions: [{ kind: "one" }] } })
    const answers = { questions: [{ questionId: "q1", optionIds: ["q1o1"], none: false, comment: "", attachments: [] }], note: "", noteAttachments: [] }
    expect(decodeEvent({ ...envelope, schemaVersion: 1, type: "ask.answered", ask: { ...ask, state: "answered", answeredAt: 2, answers } }))
      .toMatchObject({ ask: { answers: { questions: [{ optionIds: ["q1o1"] }] } } })
    expect(decodeEvent({ ...envelope, schemaVersion: 1, type: "ask.withdrawn", id: "k-1", taskId: "t-1", reason: "moved" })).toMatchObject({ reason: "moved" })
    expect(() => decodeEvent({ ...envelope, schemaVersion: 1, type: "ask.withdrawn", id: "k-1", taskId: "t-1", reason: "bored" })).toThrow()
  })

  it("decodes a finished test run on a task (CEL-181), with or without the run's task, and refuses one with no run", () => {
    const run = { label: "web e2e", command: "bun run test:e2e -- e2e/pages.spec.ts", startedAt: 1, endedAt: 9, outcome: "passed", background: true, progress: null }
    const event = decodeEvent({ ...envelope, schemaVersion: 1, type: "tests.finished", taskId: "t-1", run })
    expect(event.type === "tests.finished" && event.run.outcome).toBe("passed")
    expect(event.type === "tests.finished" && event.run.taskId).toBeUndefined()
    expect(decodeEvent({ ...envelope, schemaVersion: 1, type: "tests.finished", taskId: "t-1", run: { ...run, taskId: "t-1" } })).toMatchObject({ run: { taskId: "t-1" } })
    // It round-trips: what a store writes is what a client reads.
    expect(Schema.encodeSync(CelloEvent)(event as never)).toMatchObject({ type: "tests.finished", taskId: "t-1", run: { label: "web e2e" } })
    expect(() => decodeEvent({ ...envelope, schemaVersion: 1, type: "tests.finished", taskId: "t-1" })).toThrow()
  })

  it("fails loudly on an unknown schema version", () => {
    expect(() => decodeEvent({ ...envelope, schemaVersion: 99, type: "task.archived", id: "t-1", version: 3 })).toThrow(
      UnknownSchemaVersion,
    )
  })

  it("rejects a payload that doesn't match its type", () => {
    expect(() => decodeEvent({ ...envelope, schemaVersion: 1, type: "task.archived" })).toThrow()
  })
})

// What `events.subscribe` streams (CEL-131): a client running an older build must skip an event a newer
// server writes instead of failing its stream on it.
describe("StreamedEvent", () => {
  const decode = Schema.decodeUnknownSync(StreamedEvent)
  const archived = { ...envelope, schemaVersion: 1, type: "task.archived", id: "t-1", version: 3 }

  it("decodes an event this build knows as itself", () => {
    expect(decode(archived)).toEqual(Schema.decodeUnknownSync(CelloEvent)(archived))
  })

  // Its time too, when it has one: a task's history shows when the change it can't read happened (CEL-135).
  const unreadable = (sentType: string) => ({ type: "unreadable", seq: 7, ts: envelope.ts, sentType })

  it("reads an event of a type this build doesn't know as unreadable, keeping its seq, time and type", () => {
    expect(decode({ ...envelope, schemaVersion: 1, type: "test.from-a-newer-build", note: "only a newer build reads this" }))
      .toEqual(unreadable("test.from-a-newer-build"))
  })

  it("reads a known type in a shape this build can't read, or a newer schema version, as unreadable too", () => {
    expect(decode({ ...envelope, schemaVersion: 1, type: "task.archived" })).toEqual(unreadable("task.archived"))
    expect(decode({ ...envelope, schemaVersion: 1, type: "session.orchestrating", session: "s-1", on: true }))
      .toEqual(unreadable("session.orchestrating"))
    expect(decode({ ...archived, schemaVersion: 2 })).toEqual(unreadable("task.archived"))
  })

  it("needs only a seq and a type to skip past: an event without a time is still unreadable, not a failure", () => {
    expect(decode({ seq: 7, type: "test.from-a-newer-build" })).toEqual({ type: "unreadable", seq: 7, sentType: "test.from-a-newer-build" })
  })

  it("still refuses something that isn't an event at all: without a seq there is nothing to skip past", () => {
    expect(() => decode({ type: "task.archived" })).toThrow()
  })

  it("sends a known event exactly as before, so older clients see no change on the wire", () => {
    const event = Schema.decodeUnknownSync(CelloEvent)(archived)
    expect(Schema.encodeSync(StreamedEvent)(event)).toEqual(Schema.encodeSync(CelloEvent)(event))
  })
})
