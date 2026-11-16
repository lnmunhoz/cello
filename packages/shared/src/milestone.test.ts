import { describe, expect, it } from "vitest"
import { byPosition, compareMilestoneNames, milestoneProgress, progressText } from "./milestone.ts"

const statuses = [
  { id: "backlog", name: "Backlog", category: "backlog" },
  { id: "todo", name: "Todo", category: "unstarted" },
  { id: "doing", name: "In Progress", category: "started" },
  { id: "input", name: "Needs input", category: "waiting" },
  { id: "review", name: "In Review", category: "started" },
  { id: "done", name: "Done", category: "completed" },
  { id: "canceled", name: "Canceled", category: "canceled" },
]

const task = (statusId: string, archivedAt: number | null = null) => ({ statusId, archivedAt })

describe("milestoneProgress", () => {
  it("counts a milestone's tasks by status category: Canceled leaves the total, Backlog stays in it on its own", () => {
    const progress = milestoneProgress(
      [
        task("done"), task("done"), task("done"), task("done"), task("done"), task("done"),
        task("review"),
        task("doing"), task("input"),
        task("todo"),
        task("backlog"),
        task("canceled"),
      ],
      statuses,
    )
    expect(progress).toEqual({ total: 11, done: 6, inReview: 1, inProgress: 2, todo: 1, backlog: 1, canceled: 1, percent: 55 })
    expect(progressText(progress)).toBe("6 of 11 done · 55%")
  })

  it("leaves out archived tasks and tasks in a status it doesn't know", () => {
    expect(milestoneProgress([task("done", 5), task("todo"), task("gone")], statuses)).toMatchObject({ total: 1, done: 0, todo: 1 })
  })

  it("an empty milestone is 0 of 0 at 0%; only a finished one reads 100%", () => {
    const empty = milestoneProgress([], statuses)
    expect(empty).toMatchObject({ total: 0, done: 0, percent: 0 })
    expect(progressText(empty)).toBe("0 of 0 done")
    const almost = milestoneProgress([...Array.from({ length: 199 }, () => task("done")), task("todo")], statuses)
    expect(almost.percent).toBe(99)
    expect(milestoneProgress([task("done"), task("canceled")], statuses).percent).toBe(100)
  })
})

describe("milestone order", () => {
  it("sorts by position, then name", () => {
    const rows = [{ name: "B", position: "a1" }, { name: "A", position: "a1" }, { name: "C", position: "a0" }]
    expect([...rows].sort(byPosition).map((r) => r.name)).toEqual(["C", "A", "B"])
  })

  it("compares names with numbers in order, ignoring case: M2 before M10", () => {
    expect(["M10", "m3", "M2", "Beta"].sort(compareMilestoneNames)).toEqual(["Beta", "M2", "m3", "M10"])
  })
})
