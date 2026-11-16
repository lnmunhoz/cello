import { describe, expect, it } from "vitest"
import { claimKeepsStatus } from "./claim.ts"

describe("claimKeepsStatus", () => {
  it("a claim (or a comment's reopen, CEL-110) leaves a task where work goes on or waits on the human; anything else goes to In Progress", () => {
    expect(claimKeepsStatus("started")).toBe(true)
    expect(claimKeepsStatus("waiting")).toBe(true)
    for (const category of ["backlog", "unstarted", "completed", "canceled", undefined]) expect(claimKeepsStatus(category)).toBe(false)
  })
})
