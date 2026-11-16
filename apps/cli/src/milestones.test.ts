// Milestones in the CLI (CEL-113): matching a name, `--due`, and the text of `cello milestone list|show` and `cello context`.
import type { Milestone } from "@cello/contract/entities"
import type { MilestoneProgress } from "@cello/contract/views"
import { describe, expect, it } from "vitest"
import { contextMilestones, milestoneHeader, milestoneLine, milestoneListText, milestoneNamed, parseDue, progressDetail } from "./milestones.ts"

const milestone = (name: string, overrides: Partial<Milestone> = {}): Milestone => ({
  id: name.toLowerCase(),
  projectId: "p",
  name,
  goal: "",
  targetDate: null,
  position: "a0",
  state: "open",
  closedAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
})

const progress = (overrides: Partial<MilestoneProgress> = {}): MilestoneProgress => ({
  total: 0, done: 0, inReview: 0, inProgress: 0, todo: 0, backlog: 0, canceled: 0, percent: 0, ...overrides,
})

const NOW = 1_800_000_000_000

describe("milestoneNamed", () => {
  const list = [milestone("M2"), milestone("M3")]
  it("finds one in any case, takes none when allowed, and refuses anything else with the names and close matches", () => {
    expect(milestoneNamed(list, " m3 ", "CEL", true)).toBe(list[1])
    expect(milestoneNamed(list, "None", "CEL", true)).toBeNull()
    expect(milestoneNamed(list, "none", "CEL", false)).toBe(
      `No milestone named "none" in CEL. Milestones: M2, M3. Nothing was changed; \`cello milestone create none\` makes it.`,
    )
    expect(milestoneNamed(list, "M33", "CEL", true)).toBe(
      `No milestone named "M33" in CEL (did you mean M3?). Milestones: M2, M3 (or none). Nothing was changed; \`cello milestone create M33\` makes it.`,
    )
    expect(milestoneNamed([], "M3", "CEL", false)).toBe(
      `No milestone named "M3" in CEL. Milestones: none yet. Nothing was changed; \`cello milestone create M3\` makes it.`,
    )
  })
})

describe("parseDue", () => {
  it("takes a date, or none to clear it", () => {
    expect(parseDue(" 2026-12-01 ")).toBe("2026-12-01")
    expect(parseDue("None")).toBeNull()
    expect(parseDue("next week")).toEqual({ invalid: `--due takes a date like 2026-12-01, or none to clear it; "next week" isn't one.` })
  })
})

describe("the text", () => {
  it("one line per milestone: name, state, progress, its date or when it closed, its goal", () => {
    expect(milestoneLine(milestone("M3", { goal: "Watching agents", targetDate: "2026-12-01" }))).toBe("M3 · due 2026-12-01 · Watching agents")
    expect(milestoneLine(milestone("M2"))).toBe("M2")
    expect(milestoneListText({
      project: { key: "CEL" } as never,
      milestones: [
        { milestone: milestone("M2", { state: "closed", closedAt: NOW - 2 * 86_400_000 }), progress: progress({ total: 7, done: 7, percent: 100 }) },
        { milestone: milestone("M3", { goal: "Watching agents", targetDate: "2026-12-01" }), progress: progress({ total: 11, done: 6, percent: 55 }) },
        { milestone: milestone("M10"), progress: progress() },
      ],
    }, NOW)).toBe([
      "M2   closed  7 of 7 done · 100%  closed 2d ago",
      "M3   open    6 of 11 done · 55%  due 2026-12-01 · Watching agents",
      "M10  open    0 of 0 done",
    ].join("\n"))
    expect(milestoneListText({ project: { key: "CEL" } as never, milestones: [] }, NOW)).toBe(
      "No milestones yet in CEL. Make one with `cello milestone create <name> --goal \"…\"`.",
    )
  })

  it("the progress in words: what's left by kind, Backlog apart, Canceled not counted", () => {
    expect(progressDetail(progress({ total: 11, done: 6, inReview: 1, inProgress: 2, todo: 1, backlog: 1, canceled: 2, percent: 55 }))).toBe(
      "6 of 11 done · 55%: 1 in review, 2 in progress, 1 to do, 1 in Backlog (2 canceled, not counted)",
    )
    expect(progressDetail(progress({ total: 2, done: 2, percent: 100 }))).toBe("2 of 2 done · 100%")
    expect(progressDetail(progress())).toBe("0 of 0 done")
  })

  it("show's header: name, state, date, goal, progress", () => {
    expect(milestoneHeader(milestone("M3", { goal: "Watching agents", targetDate: "2026-12-01" }), progress({ total: 2, done: 1, todo: 1, percent: 50 }), NOW)).toEqual([
      "M3 · open · due 2026-12-01",
      "Watching agents",
      "1 of 2 done · 50%: 1 to do",
    ])
    expect(milestoneHeader(milestone("M2", { state: "closed", closedAt: NOW - 3_600_000 }), progress(), NOW)).toEqual(["M2 · closed 1h ago", "0 of 0 done"])
  })

  it("context's line: the open milestones with done/total and their date", () => {
    expect(contextMilestones([
      { milestone: milestone("M2"), progress: progress() },
      { milestone: milestone("M3", { targetDate: "2026-12-01" }), progress: progress({ total: 2, done: 1 }) },
    ], 3)).toBe("M2 0/0 done · M3 1/2 done (due 2026-12-01)")
    expect(contextMilestones([], 2)).toBe("none open")
    expect(contextMilestones([], 0)).toBe("none yet")
  })
})
