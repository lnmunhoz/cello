import type { Attachment } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { addScreenshot, commentDraftKey, EMPTY_COMMENT, readCommentDraft, removeScreenshot, toComment } from "./commentDraft.ts"

const shot = (id: string): Attachment => ({
  id, taskId: "t", reviewId: null, askId: null, kind: "image", name: `${id}.png`, url: null, caption: "", mime: "image/png", bytes: 1,
  hasPoster: false, actorId: "h", sessionId: null, createdAt: 1, deletedAt: null,
})

describe("a comment being written (CEL-73)", () => {
  it("is kept per task", () => {
    expect(commentDraftKey("01TASK")).toBe("cello:comment-draft:01TASK")
  })

  it("adds screenshots in the order pasted, and takes one out by id", () => {
    const draft = addScreenshot(addScreenshot({ ...EMPTY_COMMENT, body: "Like this" }, shot("a1")), shot("a2"))
    expect(draft.attachments.map((a) => a.id)).toEqual(["a1", "a2"])
    expect(removeScreenshot(draft, "a1").attachments.map((a) => a.id)).toEqual(["a2"])
  })

  it("survives a round trip through storage; none or a broken one is empty", () => {
    const draft = addScreenshot({ ...EMPTY_COMMENT, body: "Like this" }, shot("a1"))
    expect(readCommentDraft(JSON.stringify(draft))).toEqual(draft)
    expect(readCommentDraft(null)).toEqual(EMPTY_COMMENT)
    expect(readCommentDraft("")).toEqual(EMPTY_COMMENT)
    expect(readCommentDraft("{oops")).toEqual(EMPTY_COMMENT)
    expect(readCommentDraft(JSON.stringify({ body: 3, attachments: [{ id: "a1" }, 4] }))).toEqual({ body: "", attachments: [{ id: "a1" }] })
  })

  it("is sent with words, screenshots or both; nothing to send otherwise", () => {
    expect(toComment({ body: "  Like this ", attachments: [shot("a1")] })).toEqual({ body: "Like this", attachmentIds: ["a1"] })
    expect(toComment({ body: " ", attachments: [shot("a1")] })).toEqual({ body: "", attachmentIds: ["a1"] })
    expect(toComment({ body: "Words", attachments: [] })).toEqual({ body: "Words", attachmentIds: [] })
    expect(toComment({ body: "  ", attachments: [] })).toBeNull()
  })
})
