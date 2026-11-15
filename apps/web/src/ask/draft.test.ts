import type { AskQuestion, Attachment } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { addScreenshot, EMPTY_DRAFT, missing, pick, readDraft, removeScreenshot, screenshotsFrom, setComment, toAnswers } from "./draft.ts"

const option = (id: string) => ({ id, label: id, description: "", imageId: null, recommended: false, because: "" })
const one: AskQuestion = { id: "q1", prompt: "Which?", kind: "one", options: [option("q1o1"), option("q1o2")] }
const any: AskQuestion = { id: "q2", prompt: "Which extras?", kind: "any", options: [option("q2o1"), option("q2o2")] }
const text: AskQuestion = { id: "q3", prompt: "Else?", kind: "text", options: [] }
const shot = (id: string): Attachment => ({
  id, taskId: "t", reviewId: null, askId: "k", kind: "image", name: `${id}.png`, url: null, caption: "", mime: "image/png", bytes: 1,
  hasPoster: false, actorId: "h", sessionId: null, createdAt: 1, deletedAt: null,
})

describe("a draft of Lucas's answers", () => {
  it("picks: choose-one replaces (again clears), choose-any toggles", () => {
    let draft = pick(EMPTY_DRAFT, one, "q1o1")
    draft = pick(draft, one, "q1o2")
    expect(draft.answers.q1!.optionIds).toEqual(["q1o2"])
    expect(pick(draft, one, "q1o2").answers.q1!.optionIds).toEqual([])
    draft = pick(pick(pick(draft, any, "q2o1"), any, "q2o2"), any, "q2o1")
    expect(draft.answers.q2!.optionIds).toEqual(["q2o2"])
  })

  it("is complete when every question has a pick, words or a screenshot", () => {
    let draft = pick(EMPTY_DRAFT, one, "q1o1")
    expect(missing([one, any, text], draft)).toEqual(["q2", "q3"])
    draft = setComment(draft, "q2", "None for now")
    draft = addScreenshot(draft, { questionId: "q3" }, shot("a1"))
    expect(missing([one, any, text], draft)).toEqual([])
    expect(missing([one, any, text], removeScreenshot(draft, { questionId: "q3" }, "a1"))).toEqual(["q3"])
  })

  it("becomes what ask.answer takes, with the note and its screenshots", () => {
    let draft = setComment(pick(EMPTY_DRAFT, one, "q1o2"), "q1", "  Narrower  ")
    draft = addScreenshot(draft, { questionId: "q1" }, shot("a1"))
    draft = addScreenshot({ ...draft, note: " Thanks " }, "note", shot("a2"))
    expect(toAnswers([one, text], draft)).toEqual({
      answers: [
        { questionId: "q1", optionIds: ["q1o2"], comment: "Narrower", attachmentIds: ["a1"] },
        { questionId: "q3", optionIds: [], comment: "", attachmentIds: [] },
      ],
      note: "Thanks",
      noteAttachmentIds: ["a2"],
    })
  })

  it("survives a round trip through storage, and a broken one reads as empty", () => {
    const draft = addScreenshot(setComment(pick(EMPTY_DRAFT, one, "q1o1"), "q1", "Yes"), "note", shot("a2"))
    expect(readDraft(JSON.stringify(draft))).toEqual(draft)
    expect(readDraft(null)).toEqual(EMPTY_DRAFT)
    expect(readDraft("{oops")).toEqual(EMPTY_DRAFT)
    expect(readDraft(JSON.stringify({ answers: { q1: { optionIds: [1, "q1o1"], comment: 3 } }, note: 4 }))).toEqual({
      answers: { q1: { optionIds: ["q1o1"], comment: "", attachments: [] } },
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
