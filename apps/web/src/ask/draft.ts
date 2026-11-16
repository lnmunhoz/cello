// Lucas's answers while he writes them (CEL-47): picks, "None of these", comments and pasted
// screenshots, kept on this device until he sends, so a reload or a closed panel loses nothing. A new
// draft starts with the recommended options picked (Lucas, Nov 15); he can change them, pick several,
// or pick none of them and say why. The screenshots are uploaded as soon as they're pasted; the draft
// keeps their attachments.
import type { AskQuestion, Attachment } from "@cello/contract/entities"
import type { AnswerInput } from "@cello/contract/rpcs"
import { recommendedPicks, unanswered } from "@cello/shared/ask"
import { attachmentsIn, isRecord } from "../screenshots/screenshots.ts"

export interface DraftAnswer {
  readonly optionIds: ReadonlyArray<string>
  /** "None of these": no option fits; the comment says what instead. */
  readonly none: boolean
  readonly comment: string
  readonly attachments: ReadonlyArray<Attachment>
}

export interface AskDraft {
  readonly answers: Readonly<Record<string, DraftAnswer>>
  readonly note: string
  readonly noteAttachments: ReadonlyArray<Attachment>
}

export const EMPTY_DRAFT: AskDraft = { answers: {}, note: "", noteAttachments: [] }
const EMPTY_ANSWER: DraftAnswer = { optionIds: [], none: false, comment: "", attachments: [] }

/** A fresh draft: each question's recommended options picked. */
export const startDraft = (questions: ReadonlyArray<AskQuestion>): AskDraft => ({
  ...EMPTY_DRAFT,
  answers: Object.fromEntries(questions.map((q) => [q.id, { ...EMPTY_ANSWER, optionIds: recommendedPicks(q) }])),
})

/** Where a draft is kept: one per ask. */
export const draftKey = (askId: string): string => `cello:ask-draft:${askId}`

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [])
const files = attachmentsIn

/** A saved draft, or null when there's none or it can't be read (then a fresh one starts). */
export const readDraft = (raw: string | null): AskDraft | null => {
  if (raw === null || raw === "") return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) return null
    const answers = isRecord(value.answers) ? value.answers : {}
    return {
      answers: Object.fromEntries(Object.entries(answers).flatMap(([id, a]) =>
        isRecord(a)
          ? [[id, {
            optionIds: strings(a.optionIds),
            none: a.none === true,
            comment: typeof a.comment === "string" ? a.comment : "",
            attachments: files(a.attachments),
          }]]
          : []
      )),
      note: typeof value.note === "string" ? value.note : "",
      noteAttachments: files(value.noteAttachments),
    }
  } catch {
    return null
  }
}

export const answerOf = (draft: AskDraft, questionId: string): DraftAnswer => draft.answers[questionId] ?? EMPTY_ANSWER

const withAnswer = (draft: AskDraft, questionId: string, change: (a: DraftAnswer) => DraftAnswer): AskDraft => ({
  ...draft,
  answers: { ...draft.answers, [questionId]: change(answerOf(draft, questionId)) },
})

/** Picking an option toggles it, on any question (several picks are fine); it clears "None of these". */
export const pick = (draft: AskDraft, questionId: string, optionId: string): AskDraft =>
  withAnswer(draft, questionId, (a) => ({
    ...a,
    none: false,
    optionIds: a.optionIds.includes(optionId) ? a.optionIds.filter((id) => id !== optionId) : [...a.optionIds, optionId],
  }))

/** "None of these" toggles, and clears the picks: the comment then says what instead. */
export const pickNone = (draft: AskDraft, questionId: string): AskDraft =>
  withAnswer(draft, questionId, (a) => ({ ...a, none: !a.none, optionIds: [] }))

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

const asAnswer = (a: DraftAnswer) => ({ optionIds: a.optionIds, none: a.none, comment: a.comment, attachmentIds: a.attachments.map((f) => f.id) })

/** The questions still unanswered (ids, in order), by the server's own rule. */
export const missing = (questions: ReadonlyArray<AskQuestion>, draft: AskDraft): string[] =>
  unanswered(questions, Object.fromEntries(questions.map((q) => [q.id, asAnswer(answerOf(draft, q.id))])))

/** What `ask.answer` takes. */
export const toAnswers = (questions: ReadonlyArray<AskQuestion>, draft: AskDraft) => ({
  answers: questions.map((q): AnswerInput => {
    const a = answerOf(draft, q.id)
    return { questionId: q.id, optionIds: [...a.optionIds], none: a.none, comment: a.comment.trim(), attachmentIds: a.attachments.map((f) => f.id) }
  }),
  note: draft.note.trim(),
  noteAttachmentIds: draft.noteAttachments.map((f) => f.id),
})

