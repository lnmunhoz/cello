import { describe, expect, it } from "vitest"
import { decodeEvent, UnknownSchemaVersion } from "./events.ts"

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

  it("fails loudly on an unknown schema version", () => {
    expect(() => decodeEvent({ ...envelope, schemaVersion: 99, type: "task.archived", id: "t-1", version: 3 })).toThrow(
      UnknownSchemaVersion,
    )
  })

  it("rejects a payload that doesn't match its type", () => {
    expect(() => decodeEvent({ ...envelope, schemaVersion: 1, type: "task.archived" })).toThrow()
  })
})
