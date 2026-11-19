import { describe, expect, it } from "vitest"
import { isActiveCategory, isClosedCategory } from "./status.ts"

describe("isClosedCategory", () => {
  it("is true for the finished categories (Done, Canceled) and false for every other", () => {
    expect(isClosedCategory("completed")).toBe(true)
    expect(isClosedCategory("canceled")).toBe(true)
    for (const open of ["backlog", "unstarted", "started", "waiting"]) expect(isClosedCategory(open)).toBe(false)
  })
})

describe("isActiveCategory", () => {
  it("is true for tasks to do, in progress or waiting on Lucas: what `cello task list` shows by default", () => {
    for (const active of ["unstarted", "started", "waiting"]) expect(isActiveCategory(active)).toBe(true)
  })

  it("is false for Backlog and the finished categories", () => {
    for (const quiet of ["backlog", "completed", "canceled"]) expect(isActiveCategory(quiet)).toBe(false)
  })

  it("is true for a category this build doesn't know (other, CEL-178): its tasks are work in flight, not to be hidden", () => {
    expect(isActiveCategory("other")).toBe(true)
  })
})
