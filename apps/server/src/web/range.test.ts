import { describe, expect, it } from "vitest"
import { parseRange } from "./range.ts"

describe("parseRange", () => {
  it("no header, or one it can't read, means the whole file", () => {
    expect(parseRange(undefined, 100)).toEqual({ _tag: "Whole" })
    expect(parseRange("bytes=abc", 100)).toEqual({ _tag: "Whole" })
    expect(parseRange("items=0-5", 100)).toEqual({ _tag: "Whole" })
    // Several ranges at once: the whole file is a valid answer, and simpler than multipart.
    expect(parseRange("bytes=0-1,5-6", 100)).toEqual({ _tag: "Whole" })
  })

  it("reads start-end, start- and -suffix", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ _tag: "Partial", start: 0, end: 9 })
    expect(parseRange("bytes=90-", 100)).toEqual({ _tag: "Partial", start: 90, end: 99 })
    expect(parseRange("bytes=-10", 100)).toEqual({ _tag: "Partial", start: 90, end: 99 })
  })

  it("clamps an end past the file, and a suffix longer than it", () => {
    expect(parseRange("bytes=50-1000", 100)).toEqual({ _tag: "Partial", start: 50, end: 99 })
    expect(parseRange("bytes=-500", 100)).toEqual({ _tag: "Partial", start: 0, end: 99 })
  })

  it("a start past the end can't be satisfied", () => {
    expect(parseRange("bytes=100-", 100)).toEqual({ _tag: "Unsatisfiable" })
    expect(parseRange("bytes=5-2", 100)).toEqual({ _tag: "Unsatisfiable" })
    expect(parseRange("bytes=-0", 100)).toEqual({ _tag: "Unsatisfiable" })
    expect(parseRange("bytes=0-0", 0)).toEqual({ _tag: "Unsatisfiable" })
  })
})
