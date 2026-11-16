// The task panel's "New milestone…" (CEL-113): what its Create button does with the name typed.
import type { Milestone } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { newMilestoneStep } from "./newMilestone.ts"

const milestone = (id: string, name: string, extra: Partial<Milestone> = {}): Milestone => ({
  id, projectId: "p1", name, goal: "", targetDate: null, position: "a0", state: "open", closedAt: null, createdAt: 1, updatedAt: 1, ...extra,
})

const milestones = [milestone("m2", "M2"), milestone("m1", "M1", { state: "closed" }), milestone("t2", "M5", { projectId: "p2" })]

describe("newMilestoneStep", () => {
  it("creates a milestone under a new name, trimmed; another project's name is free here", () => {
    expect(newMilestoneStep(milestones, "p1", "CEL", " M4 ")).toEqual({ kind: "create", name: "M4" })
    expect(newMilestoneStep(milestones, "p1", "CEL", "M5")).toEqual({ kind: "create", name: "M5" })
  })

  it("puts the task in the open milestone that already has the name (a retry after the first try made it), in any case", () => {
    expect(newMilestoneStep(milestones, "p1", "CEL", "m2")).toEqual({ kind: "assign", milestoneId: "m2" })
  })

  it("refuses an empty name, and a closed milestone's name", () => {
    expect(newMilestoneStep(milestones, "p1", "CEL", "  ")).toEqual({ kind: "problem", message: "Give it a name" })
    expect(newMilestoneStep(milestones, "p1", "CEL", "M1")).toEqual({
      kind: "problem",
      message: "CEL already has a closed milestone named M1",
    })
  })
})
