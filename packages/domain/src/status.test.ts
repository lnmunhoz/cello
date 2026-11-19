import { describe, expect, it } from "vitest"
import { isClosedCategory } from "./status.ts"

describe("isClosedCategory", () => {
  it("is true for the finished categories (Done, Canceled) and false for every other", () => {
    expect(isClosedCategory("completed")).toBe(true)
    expect(isClosedCategory("canceled")).toBe(true)
    for (const open of ["backlog", "unstarted", "started", "waiting"]) expect(isClosedCategory(open)).toBe(false)
  })
})
