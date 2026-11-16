import { describe, expect, it } from "vitest"
import {
  byPosition,
  closeSuggested,
  compareMilestoneNames,
  dueText,
  findMilestone,
  localDay,
  milestoneLanes,
  mightHaveReopened,
  milestoneProgress,
  openWithoutMilestone,
  progressText,
  reopenedAfterClose,
} from "./milestone.ts"

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

describe("findMilestone", () => {
  const list = [{ name: "M2" }, { name: "M3 " }]
  it("matches a name in any case with spaces trimmed on both sides; none means no milestone where allowed", () => {
    expect(findMilestone(list, " m3", { projectKey: "CEL", allowNone: true })).toEqual({ found: list[1] })
    expect(findMilestone(list, "M2", { projectKey: "CEL", allowNone: false })).toEqual({ found: list[0] })
    expect(findMilestone(list, "None", { projectKey: "CEL", allowNone: true })).toEqual({ found: null })
  })

  it("refuses anything else with one sentence: close matches, the names, and how to make it", () => {
    expect(findMilestone(list, "M33", { projectKey: "CEL", allowNone: true })).toEqual({
      problem: `No milestone named "M33" in CEL (did you mean M3?). Milestones: M2, M3 (or none). Nothing was changed; \`cello milestone create M33\` makes it`,
    })
    expect(findMilestone(list, "none", { projectKey: "CEL", allowNone: false })).toEqual({
      problem: `No milestone named "none" in CEL. Milestones: M2, M3. Nothing was changed; \`cello milestone create none\` makes it`,
    })
    expect(findMilestone([], "M3", { projectKey: "CEL", allowNone: true })).toEqual({
      problem: `No milestone named "M3" in CEL. Milestones: none yet. Nothing was changed; \`cello milestone create M3\` makes it`,
    })
  })
})

describe("dueText", () => {
  it("counts whole calendar days to the target date: days left, due today, days late", () => {
    expect(dueText("2026-11-20", "2026-11-17")).toEqual({ text: "3 days left", late: false })
    expect(dueText("2026-11-18", "2026-11-17")).toEqual({ text: "1 day left", late: false })
    expect(dueText("2026-11-17", "2026-11-17")).toEqual({ text: "due today", late: false })
    expect(dueText("2026-11-16", "2026-11-17")).toEqual({ text: "1 day late", late: true })
    expect(dueText("2026-11-13", "2026-11-17")).toEqual({ text: "4 days late", late: true })
  })

  it("counts across a month, a year and a daylight-saving change by the calendar, not by hours", () => {
    expect(dueText("2026-12-01", "2026-11-30")).toEqual({ text: "1 day left", late: false })
    expect(dueText("2027-01-02", "2026-12-31")).toEqual({ text: "2 days left", late: false })
    expect(dueText("2026-03-30", "2026-03-28")).toEqual({ text: "2 days left", late: false })
  })

  it("localDay is the local calendar day of a moment", () => {
    expect(localDay(new Date(2026, 10, 7, 23, 59).getTime())).toBe("2026-11-07")
    expect(localDay(new Date(2026, 0, 1, 0, 0).getTime())).toBe("2026-01-01")
  })
})

describe("closeSuggested", () => {
  const open = { state: "open" as const }
  it("asks to close an open milestone once every task that counts is done", () => {
    expect(closeSuggested(open, milestoneProgress([task("done"), task("done"), task("canceled")], statuses))).toBe(true)
  })

  it("not while a task is left (Backlog counts), not for an empty one, never for a closed one", () => {
    expect(closeSuggested(open, milestoneProgress([task("done"), task("backlog")], statuses))).toBe(false)
    expect(closeSuggested(open, milestoneProgress([task("done"), task("review")], statuses))).toBe(false)
    expect(closeSuggested(open, milestoneProgress([], statuses))).toBe(false)
    expect(closeSuggested({ state: "closed" }, milestoneProgress([task("done")], statuses))).toBe(false)
  })
})

describe("reopenedAfterClose", () => {
  const closed = { state: "closed" as const, closedAt: 100 }
  const categoryOf = (id: string) => statuses.find((s) => s.id === id)?.category
  const moved = (ts: number, from: string, to: string) => ({ type: "task.moved", ts, from: { statusId: from }, to: { statusId: to } })
  const edited = (ts: number) => ({ type: "task.updated", ts })

  it("mightHaveReopened: only a task of a closed milestone, not Done or Canceled now, changed after the close, is worth reading the history of", () => {
    expect(mightHaveReopened({ updatedAt: 150 }, closed, "started")).toBe(true)
    expect(mightHaveReopened({ updatedAt: 150 }, closed, "completed")).toBe(false)
    expect(mightHaveReopened({ updatedAt: 150 }, closed, "canceled")).toBe(false)
    expect(mightHaveReopened({ updatedAt: 90 }, closed, "started")).toBe(false)
    expect(mightHaveReopened({ updatedAt: 150 }, { state: "open", closedAt: null }, "started")).toBe(false)
  })

  it("a task that moved out of Done after the close, and isn't back in Done", () => {
    expect(reopenedAfterClose(closed, "started", [moved(50, "doing", "done"), moved(150, "done", "doing")], categoryOf)).toBe(true)
  })

  it("not a task that was never Done and was only edited (or moved between open statuses) after the close", () => {
    expect(reopenedAfterClose(closed, "backlog", [edited(150)], categoryOf)).toBe(false)
    expect(reopenedAfterClose(closed, "doing", [moved(150, "todo", "doing")], categoryOf)).toBe(false)
  })

  it("not one that left Done before the close, one Done again, or one in an open milestone", () => {
    expect(reopenedAfterClose(closed, "doing", [moved(80, "done", "doing")], categoryOf)).toBe(false)
    expect(reopenedAfterClose(closed, "completed", [moved(150, "done", "doing"), moved(160, "doing", "done")], categoryOf)).toBe(false)
    expect(reopenedAfterClose({ state: "open", closedAt: null }, "started", [moved(150, "done", "doing")], categoryOf)).toBe(false)
  })
})

describe("openWithoutMilestone", () => {
  it("counts the tasks without a milestone that are still open: not Done, Canceled or archived", () => {
    const tasks = [
      { statusId: "todo", archivedAt: null, milestoneId: null },
      { statusId: "doing", archivedAt: null },
      { statusId: "backlog", archivedAt: null, milestoneId: null },
      { statusId: "done", archivedAt: null, milestoneId: null },
      { statusId: "canceled", archivedAt: null, milestoneId: null },
      { statusId: "todo", archivedAt: 5, milestoneId: null },
      { statusId: "todo", archivedAt: null, milestoneId: "m3" },
    ]
    expect(openWithoutMilestone(tasks, statuses).length).toBe(3)
  })
})

describe("milestoneLanes", () => {
  const m = (id: string, position: string, state: "open" | "closed" = "open") => ({ id, name: id.toUpperCase(), position, state })
  const milestones = [m("m3", "a2"), m("m2", "a1"), m("m1", "a0", "closed"), m("m0", "Z", "closed")]

  it("the open milestones in order, then closed ones that still show a task, then No milestone last", () => {
    const lanes = milestoneLanes(milestones, [{ milestoneId: "m1" }, { milestoneId: null }])
    expect(lanes.map((l) => l.key)).toEqual(["m2", "m3", "m1", "none"])
    expect(lanes.at(-1)!.milestone).toBeNull()
  })

  it("No milestone stays, empty, so a card can be dragged out; a task in a milestone it doesn't know is in No milestone", () => {
    expect(milestoneLanes(milestones, []).map((l) => l.key)).toEqual(["m2", "m3", "none"])
    const lanes = milestoneLanes(milestones, [{ milestoneId: "elsewhere" }])
    expect(lanes.find((l) => l.key === "none")!.has({ milestoneId: "elsewhere" })).toBe(true)
    expect(lanes.find((l) => l.key === "m2")!.has({ milestoneId: "m2" })).toBe(true)
    expect(lanes.find((l) => l.key === "m2")!.has({})).toBe(false)
  })
})
