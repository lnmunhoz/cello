import { describe, expect, it } from "vitest"
import { answerProblem, isNeedsInputStatus, needsInputNeighbors, needsInputTarget, unanswered } from "./ask.ts"

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

const one = { id: "q1", kind: "one" as const, options: [{ id: "q1o1" }, { id: "q1o2" }] }
const any = { id: "q2", kind: "any" as const, options: [{ id: "q2o1" }, { id: "q2o2" }] }
const text = { id: "q3", kind: "text" as const, options: [] }
const empty = { optionIds: [], comment: "", attachmentIds: [] }

describe("answering a question", () => {
  it("is done with a pick, or with words or a screenshot when no option fits", () => {
    expect(answerProblem(one, { ...empty, optionIds: ["q1o2"] })).toBeNull()
    expect(answerProblem(any, { ...empty, optionIds: ["q2o1", "q2o2"] })).toBeNull()
    expect(answerProblem(one, { ...empty, comment: "Neither: a third layout" })).toBeNull()
    expect(answerProblem(text, { ...empty, attachmentIds: ["a1"] })).toBeNull()
    expect(answerProblem(text, { ...empty, comment: "  " })).toBe("unanswered")
    expect(answerProblem(any, empty)).toBe("unanswered")
  })

  it("refuses two picks for choose-one, options from elsewhere, and options on a text question", () => {
    expect(answerProblem(one, { ...empty, optionIds: ["q1o1", "q1o2"] })).toBe("one option only")
    expect(answerProblem(one, { ...empty, optionIds: ["q2o1"] })).toBe("no option q2o1")
    expect(answerProblem(text, { ...empty, optionIds: ["q1o1"], comment: "x" })).toBe("no option q1o1")
  })

  it("lists the questions still unanswered, in order", () => {
    expect(unanswered([one, any, text], { q1: { ...empty, optionIds: ["q1o1"] }, q3: { ...empty, comment: "Yes" } })).toEqual(["q2"])
    expect(unanswered([one], {})).toEqual(["q1"])
  })
})
