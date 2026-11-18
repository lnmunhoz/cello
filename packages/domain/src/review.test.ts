import { describe, expect, it } from "vitest"
import { approveTarget, awaitsMerge, holdsPacket, isReviewStatus, isReviewerType, reviewTarget, sendBackTarget, stageStatus, verdictOf } from "./review.ts"

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

  // CEL-71: a packet waits on Lucas only in In Review, or in Needs input when the agent asked from there.
  it("holds an open packet in In Review or Needs input, nowhere else", () => {
    expect(holdsPacket({ name: "In Review", category: "started" })).toBe(true)
    expect(holdsPacket({ name: "Needs input", category: "waiting" })).toBe(true)
    expect(holdsPacket({ name: "Waiting on Lucas", category: "waiting" })).toBe(true)
    expect(DEFAULTS.filter((s) => s.id !== "review").map(holdsPacket)).toEqual([false, false, false, false, false])
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

// CEL-143: in a project that merges after approval, Approve leaves the task in In Review with a stage
// (Approved · merging); a stage there means exactly that, so every part tells it the same way.
describe("a task approved and waiting to be merged", () => {
  it("is a task in In Review with a stage; anywhere else, or without one, it isn't", () => {
    expect(awaitsMerge({ stage: "merging" }, { name: "In Review" })).toBe(true)
    expect(awaitsMerge({ stage: "fixing" }, { name: "in review" })).toBe(true)
    expect(awaitsMerge({ stage: null }, { name: "In Review" })).toBe(false)
    expect(awaitsMerge({ stage: "building" }, { name: "In Progress" })).toBe(false)
    expect(awaitsMerge({ stage: "merging" }, undefined)).toBe(false)
  })
})

// CEL-160: a reviewer leads its last reply with the verdict; the server stores only that word.
describe("a reviewer's verdict", () => {
  it("is read from the first lines of its reply, whatever the markdown around it", () => {
    expect(verdictOf("**Verdict: fix first** — two findings")).toBe("fix_first")
    expect(verdictOf("Verdict: merge")).toBe("merge")
    expect(verdictOf("## Verdict\n**merge**")).toBe("merge")
    expect(verdictOf("**Ask Lucas**: the task doesn't say which way")).toBe("ask")
    expect(verdictOf("\n\n**Verdict: ask the person**")).toBe("ask")
    expect(verdictOf("**merge**\n\nNo findings.")).toBe("merge")
    expect(verdictOf("**Fix first**, two blockers")).toBe("fix_first")
  })

  it("is null for prose, an empty reply, or a word that only appears further down", () => {
    expect(verdictOf("I'll merge this once the tests pass")).toBeNull()
    expect(verdictOf("Merge looks fine to me")).toBeNull()
    expect(verdictOf("")).toBeNull()
    expect(verdictOf("Reviewed the diff.\nTwo files.\nThree notes.\n**Verdict: merge**")).toBeNull()
  })

  it("belongs to reviewers: agent types ending in reviewer", () => {
    expect(isReviewerType("cello-code-reviewer")).toBe(true)
    expect(isReviewerType("cello:reviewer")).toBe(true)
    expect(isReviewerType("cello-data-reviewer")).toBe(true)
    expect(isReviewerType("cello-builder")).toBe(false)
    expect(isReviewerType(null)).toBe(false)
  })
})
