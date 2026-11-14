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
    const decided = decodeEvent({ ...envelope, schemaVersion: 1, type: "review.decided", id: "r-1", taskId: "t-1", decision: "sent_back", note: "Fix the poster" })
    expect(decided).toMatchObject({ decision: "sent_back", note: "Fix the poster" })
    expect(() => decodeEvent({ ...envelope, schemaVersion: 1, type: "review.decided", id: "r-1", taskId: "t-1", decision: "maybe", note: null })).toThrow()
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
