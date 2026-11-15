import { describe, expect, it } from "vitest"
import { clipAround, fromMarked, matchesAll, MARK_CLOSE, MARK_OPEN, oneLine, searchTerms, segments, wordPrefixRanges } from "./search.ts"

describe("search terms", () => {
  it("are the query's words, lower-cased, whatever separates them", () => {
    expect(searchTerms("  Evid  VIDEO-flow, café ")).toEqual(["evid", "video", "flow", "café"])
    expect(searchTerms("—  ")).toEqual([])
  })
})

describe("word-prefix ranges", () => {
  it("mark where each term starts a word, merged and in order", () => {
    expect(wordPrefixRanges("Evidence videos in review", ["evid", "vid"])).toEqual([[0, 4], [9, 12]])
    expect(wordPrefixRanges("provided", ["vid"])).toEqual([])
    expect(wordPrefixRanges("Review reviews", ["rev", "review"])).toEqual([[0, 6], [7, 13]])
  })

  it("every term must start some word for a text to match", () => {
    expect(matchesAll(["Switch project", "open"], ["sw", "pro"])).toBe(true)
    expect(matchesAll(["Switch project"], ["sw", "theme"])).toBe(false)
    expect(matchesAll(["anything"], [])).toBe(true)
  })
})

describe("FTS5 highlight output", () => {
  it("turns the marker characters into ranges over the plain text", () => {
    const marked = `The ${MARK_OPEN}evidence${MARK_CLOSE} video and ${MARK_OPEN}more${MARK_CLOSE}`
    expect(fromMarked(marked)).toEqual({ text: "The evidence video and more", ranges: [[4, 12], [23, 27]] })
    expect(fromMarked("nothing marked")).toEqual({ text: "nothing marked", ranges: [] })
  })

  it("an unclosed mark runs to the end", () => {
    expect(fromMarked(`a ${MARK_OPEN}bc`)).toEqual({ text: "a bc", ranges: [[2, 4]] })
  })
})

describe("clipping long text around its first match", () => {
  it("keeps short text whole", () => {
    expect(clipAround({ text: "short", ranges: [[0, 5]] }, 100)).toEqual({ text: "short", ranges: [[0, 5]] })
  })

  it("cuts at word edges with ellipses and moves the ranges", () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ")
    const text = `${words} needle ${words}`
    const at = text.indexOf("needle")
    const clipped = clipAround({ text, ranges: [[at, at + 6]] }, 80)
    expect(clipped.text.startsWith("…")).toBe(true)
    expect(clipped.text.endsWith("…")).toBe(true)
    expect(clipped.text.length).toBeLessThanOrEqual(82)
    const [start, end] = clipped.ranges[0]!
    expect(clipped.text.slice(start, end)).toBe("needle")
  })

  it("starts at the beginning when the match is near it, and drops ranges past the cut", () => {
    const text = `needle ${"x ".repeat(100)}needle`
    const clipped = clipAround({ text, ranges: [[0, 6], [text.length - 6, text.length]] }, 40)
    expect(clipped.text.startsWith("needle")).toBe(true)
    expect(clipped.ranges).toEqual([[0, 6]])
  })
})

describe("one line", () => {
  it("collapses whitespace and newlines to single spaces, moving the ranges", () => {
    const marked = { text: "  The\n\n- evidence   video\n", ranges: [[9, 17], [20, 25]] as const }
    expect(oneLine(marked)).toEqual({ text: "The - evidence video", ranges: [[6, 14], [15, 20]] })
    expect(oneLine({ text: "plain", ranges: [] })).toEqual({ text: "plain", ranges: [] })
  })
})

describe("segments", () => {
  it("split text into marked and plain pieces", () => {
    expect(segments("Go to Review", [[6, 9]])).toEqual([
      { text: "Go to ", match: false },
      { text: "Rev", match: true },
      { text: "iew", match: false },
    ])
    expect(segments("plain", [])).toEqual([{ text: "plain", match: false }])
  })
})
