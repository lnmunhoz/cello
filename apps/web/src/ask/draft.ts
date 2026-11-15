// Lucas's answers while he writes them (CEL-47): picks, comments and pasted screenshots, kept on this
// device until he sends, so a reload or a closed panel loses nothing. The screenshots are uploaded
// as soon as they're pasted; the draft keeps their attachments.
import type { AskQuestion, Attachment } from "@cello/contract/entities"
import type { AnswerInput } from "@cello/contract/rpcs"
import { unanswered } from "@cello/shared/ask"

export interface DraftAnswer {
  readonly optionIds: ReadonlyArray<string>
  readonly comment: string
  readonly attachments: ReadonlyArray<Attachment>
}

export interface AskDraft {
  readonly answers: Readonly<Record<string, DraftAnswer>>
  readonly note: string
  readonly noteAttachments: ReadonlyArray<Attachment>
}

export const EMPTY_DRAFT: AskDraft = { answers: {}, note: "", noteAttachments: [] }
const EMPTY_ANSWER: DraftAnswer = { optionIds: [], comment: "", attachments: [] }

/** Where a draft is kept: one per ask. */
export const draftKey = (askId: string): string => `cello:ask-draft:${askId}`

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [])
const files = (v: unknown): Attachment[] => (Array.isArray(v) ? v.filter((a): a is Attachment => isRecord(a) && typeof a.id === "string") : [])

/** A saved draft, or an empty one when there's none or it can't be read. */
export const readDraft = (raw: string | null): AskDraft => {
  if (raw === null) return EMPTY_DRAFT
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) return EMPTY_DRAFT
    const answers = isRecord(value.answers) ? value.answers : {}
    return {
      answers: Object.fromEntries(Object.entries(answers).flatMap(([id, a]) =>
        isRecord(a) ? [[id, { optionIds: strings(a.optionIds), comment: typeof a.comment === "string" ? a.comment : "", attachments: files(a.attachments) }]] : []
      )),
      note: typeof value.note === "string" ? value.note : "",
      noteAttachments: files(value.noteAttachments),
    }
  } catch {
    return EMPTY_DRAFT
  }
}

export const answerOf = (draft: AskDraft, questionId: string): DraftAnswer => draft.answers[questionId] ?? EMPTY_ANSWER

const withAnswer = (draft: AskDraft, questionId: string, change: (a: DraftAnswer) => DraftAnswer): AskDraft => ({
  ...draft,
  answers: { ...draft.answers, [questionId]: change(answerOf(draft, questionId)) },
})

/** Picking an option: choose-one replaces the pick (picking it again clears it); choose-any toggles it. */
export const pick = (draft: AskDraft, question: Pick<AskQuestion, "id" | "kind">, optionId: string): AskDraft =>
  withAnswer(draft, question.id, (a) => {
    const picked = a.optionIds.includes(optionId)
    if (question.kind === "one") return { ...a, optionIds: picked ? [] : [optionId] }
    return { ...a, optionIds: picked ? a.optionIds.filter((id) => id !== optionId) : [...a.optionIds, optionId] }
  })

export const setComment = (draft: AskDraft, questionId: string, comment: string): AskDraft =>
  withAnswer(draft, questionId, (a) => ({ ...a, comment }))

/** Where a screenshot goes: a question's comment box, or the note. */
export type Target = { readonly questionId: string } | "note"

export const addScreenshot = (draft: AskDraft, target: Target, attachment: Attachment): AskDraft =>
  target === "note"
    ? { ...draft, noteAttachments: [...draft.noteAttachments, attachment] }
    : withAnswer(draft, target.questionId, (a) => ({ ...a, attachments: [...a.attachments, attachment] }))

export const removeScreenshot = (draft: AskDraft, target: Target, attachmentId: string): AskDraft =>
  target === "note"
    ? { ...draft, noteAttachments: draft.noteAttachments.filter((a) => a.id !== attachmentId) }
    : withAnswer(draft, target.questionId, (a) => ({ ...a, attachments: a.attachments.filter((f) => f.id !== attachmentId) }))

/** The questions still unanswered (ids, in order), by the server's own rule. */
export const missing = (questions: ReadonlyArray<AskQuestion>, draft: AskDraft): string[] =>
  unanswered(questions, Object.fromEntries(questions.map((q) => {
    const a = answerOf(draft, q.id)
    return [q.id, { optionIds: a.optionIds, comment: a.comment, attachmentIds: a.attachments.map((f) => f.id) }]
  })))

/** What `ask.answer` takes. */
export const toAnswers = (questions: ReadonlyArray<AskQuestion>, draft: AskDraft) => ({
  answers: questions.map((q): AnswerInput => {
    const a = answerOf(draft, q.id)
    return { questionId: q.id, optionIds: [...a.optionIds], comment: a.comment.trim(), attachmentIds: a.attachments.map((f) => f.id) }
  }),
  note: draft.note.trim(),
  noteAttachmentIds: draft.noteAttachments.map((f) => f.id),
})

/** The image types Lucas can paste or drop (the server accepts the same), and the extension for a nameless one. */
export const SCREENSHOT_TYPES: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
}
export const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024

/** The pasted or dropped files to upload, each with a name the server can type; what's left out, and why. */
export const screenshotsFrom = (
  list: ReadonlyArray<{ readonly name: string; readonly type: string; readonly size: number }>,
): { readonly accepted: Array<{ readonly index: number; readonly name: string }>; readonly refused: string[] } => {
  const accepted: Array<{ index: number; name: string }> = []
  const refused: string[] = []
  list.forEach((file, index) => {
    const ext = SCREENSHOT_TYPES[file.type]
    if (ext === undefined) refused.push(`${file.name || "That file"} isn't a PNG, JPEG, GIF or WebP image`)
    else if (file.size > MAX_SCREENSHOT_BYTES) refused.push(`${file.name || "That image"} is over 20 MB`)
    else accepted.push({ index, name: /\.[a-z0-9]+$/i.test(file.name) ? file.name : `${file.name || "screenshot"}${ext}` })
  })
  return { accepted, refused }
}
