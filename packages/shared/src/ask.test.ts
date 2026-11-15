import { describe, expect, it } from "vitest"
import { answerProblem, isNeedsInputStatus, needsInputNeighbors, needsInputTarget, recommendedPicks, unanswered } from "./ask.ts"

const status = (id: string, name: string, category: string, position: string) => ({ id, name, category, position })

const DEFAULTS = [
  status("backlog", "Backlog", "backlog", "a0"),
  status("todo", "Todo", "unstarted", "a1"),
  status("doing", "In Progress", "started", "a2"),
  status("review", "In Review", "started", "a3"),
  status("done", "Done", "completed", "a4"),
  status("canceled", "Canceled", "canceled", "a5"),
]

describe("the Needs input status", () => {
  it("is the waiting status, or (renamed nowhere) one named Needs input", () => {
    expect(isNeedsInputStatus({ name: "Waiting on Lucas", category: "waiting" })).toBe(true)
    expect(isNeedsInputStatus({ name: " needs input ", category: "started" })).toBe(true)
    expect(isNeedsInputStatus({ name: "In Progress", category: "started" })).toBe(false)
  })

  it("an ask moves the task to the first waiting status, else the first one named Needs input", () => {
    const withWaiting = [...DEFAULTS, status("input", "Asked", "waiting", "a25")]
    expect(needsInputTarget(withWaiting)?.id).toBe("input")
    expect(needsInputTarget([...DEFAULTS, status("named", "Needs input", "started", "a25")])?.id).toBe("named")
    expect(needsInputTarget(DEFAULTS)).toBeNull()
  })

  it("goes right before In Review in an existing workspace", () => {
    expect(needsInputNeighbors(DEFAULTS)).toEqual({ before: "a2", after: "a3" })
  })

  it("without In Review, right after the last started status; without one, before the first completed", () => {
    const noReview = DEFAULTS.filter((s) => s.id !== "review")
    expect(needsInputNeighbors(noReview)).toEqual({ before: "a2", after: "a4" })
    const bare = [status("todo", "Todo", "unstarted", "a1"), status("done", "Done", "completed", "a4")]
    expect(needsInputNeighbors(bare)).toEqual({ before: "a1", after: "a4" })
    expect(needsInputNeighbors([])).toEqual({ before: null, after: null })
  })
})

const option = (id: string, recommended = false) => ({ id, recommended })
const one = { id: "q1", kind: "one" as const, options: [option("q1o1", true), option("q1o2")] }
const any = { id: "q2", kind: "any" as const, options: [option("q2o1", true), option("q2o2", true)] }
const text = { id: "q3", kind: "text" as const, options: [] }
const empty = { optionIds: [], none: false, comment: "", attachmentIds: [] }

describe("answering a question (Lucas, Nov 15)", () => {
  it("a question with options takes one pick or several, whatever its kind", () => {
    expect(answerProblem(one, { ...empty, optionIds: ["q1o2"] })).toBeNull()
    expect(answerProblem(one, { ...empty, optionIds: ["q1o1", "q1o2"] })).toBeNull()
    expect(answerProblem(any, { ...empty, optionIds: ["q2o1", "q2o2"] })).toBeNull()
  })

  it("or None of these, with a comment that says what instead", () => {
    expect(answerProblem(one, { ...empty, none: true, comment: "A third layout" })).toBeNull()
    expect(answerProblem(one, { ...empty, none: true, comment: "  " })).toBe("say why none of these")
    expect(answerProblem(one, { ...empty, none: true, optionIds: ["q1o1"], comment: "x" })).toBe("none of these, or picks, not both")
    // A comment alone isn't an answer to a question with options.
    expect(answerProblem(one, { ...empty, comment: "Hmm" })).toBe("unanswered")
  })

  it("a text-only question needs words", () => {
    expect(answerProblem(text, { ...empty, comment: "Ship it" })).toBeNull()
    expect(answerProblem(text, { ...empty, attachmentIds: ["a1"] })).toBe("unanswered")
    expect(answerProblem(text, { ...empty, comment: "x", none: true })).toBe("no options to refuse")
  })

  it("refuses options from elsewhere", () => {
    expect(answerProblem(one, { ...empty, optionIds: ["q2o1"] })).toBe("no option q2o1")
    expect(answerProblem(text, { ...empty, optionIds: ["q1o1"], comment: "x" })).toBe("no option q1o1")
  })

  it("lists the questions still unanswered, in order", () => {
    expect(unanswered([one, any, text], { q1: { ...empty, optionIds: ["q1o1"] }, q3: { ...empty, comment: "Yes" } })).toEqual(["q2"])
    expect(unanswered([one], {})).toEqual(["q1"])
  })

  it("starts with the recommended options picked", () => {
    expect(recommendedPicks(one)).toEqual(["q1o1"])
    expect(recommendedPicks(any)).toEqual(["q2o1", "q2o2"])
    expect(recommendedPicks(text)).toEqual([])
  })
})
