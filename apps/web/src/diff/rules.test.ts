import { describe, expect, it } from "vitest"
import { canSplit, formatCount, gutterDigits, shownMode, SPLIT_MIN_WIDTH, summaryParts } from "./rules.ts"

describe("shownMode: what the diff view draws at this width", () => {
  it("Split needs room for two readable columns", () => {
    expect(SPLIT_MIN_WIDTH).toBe(720)
    expect(canSplit(720)).toBe(true)
    expect(canSplit(719)).toBe(false)
    expect(canSplit(0)).toBe(false)
  })
  it("a chosen Split shows Unified while the view is narrow, and Split again when it's wide", () => {
    expect(shownMode("split", 600)).toBe("unified")
    expect(shownMode("split", 900)).toBe("split")
  })
  it("Unified and Raw never change with the width", () => {
    expect(shownMode("unified", 300)).toBe("unified")
    expect(shownMode("unified", 1200)).toBe("unified")
    expect(shownMode("raw", 300)).toBe("raw")
  })
})

describe("summaryParts: the summary row", () => {
  it("counts files, additions and deletions, with a real minus sign", () => {
    expect(summaryParts({ files: 6, additions: 42, deletions: 17 })).toEqual({ files: "6 files changed", additions: "+42", deletions: "−17" })
    expect(summaryParts({ files: 1, additions: 1, deletions: 0 })).toEqual({ files: "1 file changed", additions: "+1", deletions: "−0" })
  })
})

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(3000)).toBe("3,000")
    expect(formatCount(12)).toBe("12")
  })
})

describe("gutterDigits: the width of a line-number column", () => {
  it("is the digits of the largest number a file shows, at least two", () => {
    expect(gutterDigits(7)).toBe(2)
    expect(gutterDigits(99)).toBe(2)
    expect(gutterDigits(1234)).toBe(4)
  })
})
