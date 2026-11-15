import { describe, expect, it } from "vitest"
import { approveTarget, isReviewStatus, reviewTarget, sendBackTarget, stageStatus } from "./review.ts"

const status = (id: string, name: string, category: string, position: string) => ({ id, name, category, position })

const DEFAULTS = [
  status("backlog", "Backlog", "backlog", "a0"),
  status("todo", "Todo", "unstarted", "a1"),
  status("doing", "In Progress", "started", "a2"),
  status("review", "In Review", "started", "a3"),
  status("done", "Done", "completed", "a4"),
  status("canceled", "Canceled", "canceled", "a5"),
]

describe("the review status", () => {
  it("is the status named In Review, ignoring case and spaces", () => {
    expect(isReviewStatus("In Review")).toBe(true)
    expect(isReviewStatus(" in review ")).toBe(true)
    expect(isReviewStatus("Review")).toBe(false)
  })

  it("a submitted review moves the task to the first status named In Review", () => {
    expect(reviewTarget(DEFAULTS, "todo")?.id).toBe("review")
    expect(reviewTarget([...DEFAULTS].reverse(), "doing")?.id).toBe("review")
  })

  it("without one, to the first started status after the current one", () => {
    const custom = [
      status("todo", "Todo", "unstarted", "a1"),
      status("build", "Building", "started", "a2"),
      status("check", "Checking", "started", "a3"),
      status("done", "Done", "completed", "a4"),
    ]
    expect(reviewTarget(custom, "build")?.id).toBe("check")
    expect(reviewTarget(custom, "todo")?.id).toBe("build")
    expect(reviewTarget(custom, "check")).toBeNull()
  })

  it("approving goes to the first completed status; sending back to the first started one", () => {
    expect(approveTarget([...DEFAULTS].reverse())?.id).toBe("done")
    expect(sendBackTarget([...DEFAULTS].reverse())?.id).toBe("doing")
    expect(approveTarget([status("todo", "Todo", "unstarted", "a1")])).toBeNull()
  })
})

describe("stageStatus", () => {

  it("is the first started status by position: where a claim puts a task", () => {
    const statuses = [status("review", "In Review", "started", "a3"), status("todo", "Todo", "unstarted", "a1"), status("progress", "In Progress", "started", "a2")]
    expect(stageStatus(statuses)?.id).toBe("progress")
  })

  it("is null without a started status", () => {
    expect(stageStatus([status("todo", "Todo", "unstarted", "a1")])).toBeNull()
  })
})
