// Needs input (CEL-47): where an ask moves a task, where the status goes in a workspace that doesn't
// have it yet, and when a question counts as answered. The server applies these; the web app uses the
// same rules for its column and its Send answers button. Answering follows what Lucas decided on Nov 15:
// several picks on any question with options, or "None of these" with a comment.

interface StatusLike {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly position: string
}

export const NEEDS_INPUT_STATUS_NAME = "Needs input"

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The waiting status, or one named Needs input (a workspace that made its own before CEL-47). */
export const isNeedsInputStatus = (status: { readonly name: string; readonly category: string }): boolean =>
  status.category === "waiting" || sameName(status.name, NEEDS_INPUT_STATUS_NAME)

const sorted = <S extends StatusLike>(statuses: ReadonlyArray<S>): S[] =>
  [...statuses].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))

/** Where an ask moves the task: the first waiting status, else the first named Needs input. */
export const needsInputTarget = <S extends StatusLike>(statuses: ReadonlyArray<S>): S | null => {
  const ordered = sorted(statuses)
  return ordered.find((s) => s.category === "waiting") ?? ordered.find((s) => isNeedsInputStatus(s)) ?? null
}

/**
 * The positions Needs input goes between in a workspace that lacks it: right before In Review; without
 * one, right after the last started status; without that, before the first completed one.
 */
export const needsInputNeighbors = (statuses: ReadonlyArray<StatusLike>): { before: string | null; after: string | null } => {
  const ordered = sorted(statuses)
  const between = (index: number) => ({ before: ordered[index - 1]?.position ?? null, after: ordered[index]?.position ?? null })
  const review = ordered.findIndex((s) => sameName(s.name, "In Review"))
  if (review !== -1) return between(review)
  const lastStarted = ordered.findLastIndex((s) => s.category === "started")
  if (lastStarted !== -1) return between(lastStarted + 1)
  const firstDone = ordered.findIndex((s) => s.category === "completed" || s.category === "canceled")
  return between(firstDone === -1 ? ordered.length : firstDone)
}

interface QuestionLike {
  readonly id: string
  readonly kind: "one" | "any" | "text"
  readonly options: ReadonlyArray<{ readonly id: string; readonly recommended?: boolean }>
}

interface AnswerLike {
  readonly optionIds: ReadonlyArray<string>
  /** "None of these": no option fits; the comment says what instead. */
  readonly none: boolean
  readonly comment: string
  readonly attachmentIds: ReadonlyArray<string>
}

/**
 * What's wrong with an answer, or null. A question with options takes one pick or several (its kind
 * only says what the agent expects), or "None of these" with a comment; a text-only one takes words.
 */
export const answerProblem = (question: QuestionLike, answer: AnswerLike): string | null => {
  const stranger = answer.optionIds.find((id) => !question.options.some((o) => o.id === id))
  if (stranger !== undefined) return `no option ${stranger}`
  const said = answer.comment.trim() !== ""
  if (question.options.length === 0) {
    if (answer.none) return "no options to refuse"
    return said ? null : "unanswered"
  }
  if (answer.none) {
    if (answer.optionIds.length > 0) return "none of these, or picks, not both"
    return said ? null : "say why none of these"
  }
  return answer.optionIds.length > 0 ? null : "unanswered"
}

/** The ids of the questions without a valid answer, in order. */
export const unanswered = (
  questions: ReadonlyArray<QuestionLike>,
  answers: Readonly<Record<string, AnswerLike | undefined>>,
): string[] =>
  questions.filter((q) => {
    const answer = answers[q.id]
    return answer === undefined || answerProblem(q, answer) !== null
  }).map((q) => q.id)

/** What a question starts with picked: the options the agent recommends. Lucas can change them. */
export const recommendedPicks = (question: QuestionLike): string[] => question.options.filter((o) => o.recommended).map((o) => o.id)

