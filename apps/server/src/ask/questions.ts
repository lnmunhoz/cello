// An agent's questions as it wrote them, checked and given ids ("q1", "q1o2"). Option images stay as
// paths here; AskService stores them with the evidence and swaps in the attachment ids.
import type { AskQuestion, QuestionKind } from "@cello/contract/entities"
import { Invalid } from "@cello/contract/errors"
import type { AskQuestionInput } from "@cello/contract/rpcs"
import * as Effect from "effect/Effect"

export interface CheckedOption {
  readonly id: string
  readonly label: string
  readonly description: string
  /** An absolute path to an image file, or null. */
  readonly image: string | null
  readonly recommended: boolean
  readonly because: string
}

export interface CheckedQuestion {
  readonly id: string
  readonly prompt: string
  readonly kind: QuestionKind
  readonly options: ReadonlyArray<CheckedOption>
}

/** Questions an agent may ask in one go. */
export const MAX_QUESTIONS = 20
/** Options per question: the keyboard picks 1 to 9. */
export const MAX_OPTIONS = 9

const fail = (reason: string) => Effect.fail(new Invalid({ field: "questions", reason }))

export const checkQuestions = (inputs: ReadonlyArray<AskQuestionInput>): Effect.Effect<CheckedQuestion[], Invalid> =>
  Effect.gen(function* () {
    if (inputs.length === 0) return yield* fail("ask at least one question")
    if (inputs.length > MAX_QUESTIONS) return yield* fail(`ask at most ${MAX_QUESTIONS} questions at once`)
    const questions: CheckedQuestion[] = []
    for (const [i, input] of inputs.entries()) {
      const n = i + 1
      const prompt = input.prompt.trim()
      if (prompt === "") return yield* fail(`question ${n} has no text`)
      const given = input.options ?? []
      const kind: QuestionKind = input.kind ?? (given.length > 0 ? "one" : "text")
      if (kind === "text" && given.length > 0) return yield* fail(`question ${n} is text only, so it can't have options`)
      if (kind !== "text" && given.length === 0) return yield* fail(`question ${n} needs options to choose from (or kind "text")`)
      if (given.length > MAX_OPTIONS) return yield* fail(`question ${n} has ${given.length} options; the most is ${MAX_OPTIONS}`)
      const options: CheckedOption[] = []
      for (const [j, option] of given.entries()) {
        const label = option.label.trim()
        if (label === "") return yield* fail(`option ${j + 1} of question ${n} has no label`)
        const because = option.because?.trim() ?? ""
        const recommended = option.recommended === true
        if (recommended && because === "") return yield* fail(`say why you recommend "${label}" (because)`)
        if (!recommended && because !== "") return yield* fail(`"${label}" has a reason (because) but isn't recommended`)
        options.push({
          id: `q${n}o${j + 1}`,
          label,
          description: option.description?.trim() ?? "",
          image: option.image ?? null,
          recommended,
          because,
        })
      }
      if (kind === "one" && options.filter((o) => o.recommended).length > 1) {
        return yield* fail(`question ${n} asks for one pick, so recommend one option at most`)
      }
      questions.push({ id: `q${n}`, prompt, kind, options })
    }
    return questions
  })

/** The questions as stored, with each option's image as an attachment id. */
export const withImages = (questions: ReadonlyArray<CheckedQuestion>, imageIds: ReadonlyMap<string, string>): AskQuestion[] =>
  questions.map((q) => ({
    ...q,
    options: q.options.map(({ image, ...o }) => ({ ...o, imageId: image === null ? null : imageIds.get(image) ?? null })),
  }))
