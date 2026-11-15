import { describe, expect, it } from "vitest"
import { nextAfterDecision, parseReviewSearch, decisionNote, rowKey } from "./queue.ts"

describe("parseReviewSearch: the open row lives in the URL", () => {
  it("keeps a task key, uppercased", () => {
    expect(parseReviewSearch({ open: "CEL-12" })).toEqual({ open: "CEL-12" })
    expect(parseReviewSearch({ open: "cel-12" })).toEqual({ open: "CEL-12" })
  })

  it("drops anything else", () => {
    for (const open of [undefined, "", "CEL", "../settings", 12, ["CEL-1"]]) expect(parseReviewSearch({ open })).toEqual({})
  })
})

describe("nextAfterDecision: after Approve or Send back, the next row opens", () => {
  const keys = ["CEL-3", "CEL-7", "THAI-2"]
  it("the row after the one decided", () => {
    expect(nextAfterDecision(keys, "CEL-3")).toBe("CEL-7")
    expect(nextAfterDecision(keys, "CEL-7")).toBe("THAI-2")
  })
  it("the one before it when it was the last, and none when it was the only one", () => {
    expect(nextAfterDecision(keys, "THAI-2")).toBe("CEL-7")
    expect(nextAfterDecision(["CEL-3"], "CEL-3")).toBeUndefined()
  })
  it("none for a row that isn't in the queue any more", () => {
    expect(nextAfterDecision(keys, "CEL-99")).toBeUndefined()
  })
})

describe("rowKey: j and k move between rows like ↓ and ↑", () => {
  it("maps j and k, and leaves other keys as they are", () => {
    expect(rowKey("j")).toBe("ArrowDown")
    expect(rowKey("k")).toBe("ArrowUp")
    expect(rowKey("ArrowDown")).toBe("ArrowDown")
    expect(rowKey("Home")).toBe("Home")
    expect(rowKey("J")).toBe("J")
  })
})

describe("decisionNote: Send back and Approve on the Review page send what's in the comment box (CEL-70)", () => {
  it("the typed text, trimmed, is the note", () => {
    expect(decisionNote("  The poster frame is black.\n")).toBe("The poster frame is black.")
  })

  it("an empty box has no note: Send back asks for one, Approve goes without", () => {
    for (const text of ["", "   ", "\n\t"]) expect(decisionNote(text)).toBeNull()
  })
})
