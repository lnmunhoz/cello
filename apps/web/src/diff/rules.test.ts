import { describe, expect, it } from "vitest"
import { canSplit, formatCount, gutterDigits, INLINE_SHOW_AS_MIN_WIDTH, inlineControls, shownMode, SPLIT_MIN_WIDTH, summaryParts } from "./rules.ts"

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
  it("has no files piece when the diff has only hunks without a file header", () => {
    expect(summaryParts({ files: 0, additions: 3, deletions: 2 })).toEqual({ files: null, additions: "+3", deletions: "−2" })
  })
})

describe("inlineControls: what the summary row of a diff inside a comment or page offers", () => {
  it("Show as needs 360 px, the narrowest a task panel gets; under it only Copy shows", () => {
    expect(INLINE_SHOW_AS_MIN_WIDTH).toBe(360)
    expect(inlineControls(0)).toEqual({ showAs: false, split: false })
    expect(inlineControls(359)).toEqual({ showAs: false, split: false })
    expect(inlineControls(360)).toEqual({ showAs: true, split: false })
  })
  it("Split comes at the same width as for a file", () => {
    expect(inlineControls(719)).toEqual({ showAs: true, split: false })
    expect(inlineControls(720)).toEqual({ showAs: true, split: true })
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
