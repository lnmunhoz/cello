import type { Comment } from "@cello/contract/entities"
import type { CelloEvent, EventBody } from "@cello/contract/events"
import { describe, expect, it } from "vitest"
import { applyCommentEvents } from "./comments.ts"

const comment = (id: string, taskId = "t1", body = id): Comment => ({
  id, taskId, body, actorId: "me", sessionId: null, createdAt: 1, updatedAt: 1, deletedAt: null,
})
const ev = (seq: number, body: EventBody): CelloEvent =>
  ({ seq, ts: 100 + seq, commandId: `c${seq}`, actorId: "me", sessionId: null, workspaceId: "w1", projectId: "p1", schemaVersion: 1, ...body }) as CelloEvent

describe("applyCommentEvents", () => {
  it("adds this task's comments, edits and deletes by id, and ignores other tasks", () => {
    const start = [comment("a")]
    const next = applyCommentEvents(start, "t1", [
      ev(1, { type: "comment.added", comment: comment("b") }),
      ev(2, { type: "comment.added", comment: comment("x", "t2") }),
      ev(3, { type: "comment.edited", id: "a", before: { body: "a" }, after: { body: "edited" } }),
      ev(4, { type: "comment.deleted", id: "b" }),
    ])
    expect(next.map((c) => [c.id, c.body, c.deletedAt])).toEqual([["a", "edited", null], ["b", "b", 104]])
  })

  it("returns the same list when no event concerns it", () => {
    const start = [comment("a")]
    expect(applyCommentEvents(start, "t1", [ev(1, { type: "task.archived", id: "t1", version: 2 })])).toBe(start)
  })

  it("adds and removes reactions on this task's comments (CEL-77), once each", () => {
    const thumbs = { id: "r1", commentId: "a", taskId: "t1", emoji: "👍", actorId: "me", sessionId: null, createdAt: 5 }
    const party = { ...thumbs, id: "r2", emoji: "🎉" }
    const start = [comment("a"), comment("b")]
    const next = applyCommentEvents(start, "t1", [
      ev(1, { type: "reaction.added", reaction: thumbs }),
      ev(2, { type: "reaction.added", reaction: thumbs }),
      ev(3, { type: "reaction.added", reaction: party }),
      ev(4, { type: "reaction.added", reaction: { ...thumbs, id: "r9", commentId: "x", taskId: "t2" } }),
      ev(5, { type: "reaction.removed", reaction: thumbs }),
    ])
    expect(next.map((c) => [c.id, (c.reactions ?? []).map((r) => r.id)])).toEqual([["a", ["r2"]], ["b", []]])
    expect(next[1]).toBe(start[1])
  })

  it("fills in a comment's receipt when its session takes it (CEL-76)", () => {
    const start = [{ ...comment("a"), delivery: { sessionId: "s1", readAt: null, via: null } }, comment("b")]
    const next = applyCommentEvents(start, "t1", [ev(1, { type: "comment.delivered", commentId: "a", taskId: "t1", session: "s1", via: "hook" })])
    expect(next[0]!.delivery).toEqual({ sessionId: "s1", readAt: 101, via: "hook" })
    expect(next[1]).toBe(start[1])
  })

  it("doesn't add a comment twice", () => {
    const start = [comment("a")]
    expect(applyCommentEvents(start, "t1", [ev(1, { type: "comment.added", comment: comment("a") })])).toHaveLength(1)
  })
})
