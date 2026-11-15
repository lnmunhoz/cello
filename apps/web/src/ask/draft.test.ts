import type { AskQuestion, Attachment } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import {
  addScreenshot,
  EMPTY_DRAFT,
  missing,
  pick,
  pickNone,
  readDraft,
  removeScreenshot,
  screenshotsFrom,
  setComment,
  startDraft,
  toAnswers,
} from "./draft.ts"

const option = (id: string, recommended = false) => ({ id, label: id, description: "", imageId: null, recommended, because: recommended ? "why" : "" })
const one: AskQuestion = { id: "q1", prompt: "Which?", kind: "one", options: [option("q1o1", true), option("q1o2")] }
const any: AskQuestion = { id: "q2", prompt: "Which extras?", kind: "any", options: [option("q2o1"), option("q2o2")] }
const text: AskQuestion = { id: "q3", prompt: "Else?", kind: "text", options: [] }
const shot = (id: string): Attachment => ({
  id, taskId: "t", reviewId: null, askId: "k", kind: "image", name: `${id}.png`, url: null, caption: "", mime: "image/png", bytes: 1,
  hasPoster: false, actorId: "h", sessionId: null, createdAt: 1, deletedAt: null,
})

describe("a draft of Lucas's answers", () => {
  it("starts with the recommended options picked", () => {
    const draft = startDraft([one, any, text])
    expect([draft.answers.q1!.optionIds, draft.answers.q2!.optionIds, draft.answers.q3!.optionIds]).toEqual([["q1o1"], [], []])
    expect(missing([one, any, text], draft)).toEqual(["q2", "q3"])
  })

  it("picks toggle, several on any question; None of these clears them, and a pick clears it", () => {
    let draft = pick(startDraft([one]), "q1", "q1o2")
    expect(draft.answers.q1!.optionIds).toEqual(["q1o1", "q1o2"])
    draft = pick(draft, "q1", "q1o1")
    expect(draft.answers.q1!.optionIds).toEqual(["q1o2"])
    draft = pickNone(draft, "q1")
    expect(draft.answers.q1).toMatchObject({ none: true, optionIds: [] })
    expect(pick(draft, "q1", "q1o1").answers.q1).toMatchObject({ none: false, optionIds: ["q1o1"] })
  })

  it("is complete when every question has a pick, None of these with a comment, or words", () => {
    let draft = pickNone(EMPTY_DRAFT, "q1")
    draft = pick(draft, "q2", "q2o2")
    expect(missing([one, any, text], draft)).toEqual(["q1", "q3"])
    draft = setComment(setComment(draft, "q1", "A third layout"), "q3", "Ship it")
    expect(missing([one, any, text], draft)).toEqual([])
    expect(missing([text], addScreenshot(EMPTY_DRAFT, { questionId: "q3" }, shot("a1")))).toEqual(["q3"])
  })

  it("becomes what ask.answer takes, with the note and its screenshots", () => {
    let draft = setComment(pick(EMPTY_DRAFT, "q1", "q1o2"), "q1", "  Narrower  ")
    draft = addScreenshot(draft, { questionId: "q1" }, shot("a1"))
    draft = addScreenshot({ ...draft, note: " Thanks " }, "note", shot("a2"))
    expect(toAnswers([one, text], draft)).toEqual({
      answers: [
        { questionId: "q1", optionIds: ["q1o2"], none: false, comment: "Narrower", attachmentIds: ["a1"] },
        { questionId: "q3", optionIds: [], none: false, comment: "", attachmentIds: [] },
      ],
      note: "Thanks",
      noteAttachmentIds: ["a2"],
    })
    expect(missing([one], removeScreenshot(draft, { questionId: "q1" }, "a1"))).toEqual([])
  })

  it("survives a round trip through storage; none or a broken one starts fresh", () => {
    const draft = addScreenshot(setComment(pickNone(EMPTY_DRAFT, "q1"), "q1", "Neither"), "note", shot("a2"))
    expect(readDraft(JSON.stringify(draft))).toEqual(draft)
    expect(readDraft(null)).toBeNull()
    expect(readDraft("")).toBeNull()
    expect(readDraft("{oops")).toBeNull()
    expect(readDraft(JSON.stringify({ answers: { q1: { optionIds: [1, "q1o1"], comment: 3 } }, note: 4 }))).toEqual({
      answers: { q1: { optionIds: ["q1o1"], none: false, comment: "", attachments: [] } },
      note: "",
      noteAttachments: [],
    })
  })

  it("takes pasted images only, up to 20 MB, and names a nameless one", () => {
    expect(screenshotsFrom([
      { name: "image.png", type: "image/png", size: 10 },
      { name: "", type: "image/jpeg", size: 10 },
      { name: "notes.pdf", type: "application/pdf", size: 10 },
      { name: "huge.webp", type: "image/webp", size: 21 * 1024 * 1024 },
    ])).toEqual({
      accepted: [{ index: 0, name: "image.png" }, { index: 1, name: "screenshot.jpg" }],
      refused: ["notes.pdf isn't a PNG, JPEG, GIF or WebP image", "huge.webp is over 20 MB"],
    })
  })
})
