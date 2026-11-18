import { describe, expect, it } from "vitest"
import { type DecisionState, decisionStep, IDLE, nextAfterDecision, parseReviewSearch, decisionNote, rowKey, withHeld } from "./queue.ts"

describe("decisionStep: what a row shows from the click on Approve or Send back until it has left (CEL-187)", () => {
  const pending: DecisionState = { phase: "pending", decision: "approved" }
  const failed: DecisionState = { phase: "failed", decision: "sent_back", message: "Can't reach the Cello server" }

  it("a click is pending until the server answers", () => {
    expect(decisionStep(IDLE, { type: "clicked", decision: "approved" })).toEqual(pending)
    expect(decisionStep(IDLE, { type: "clicked", decision: "sent_back" })).toEqual({ phase: "pending", decision: "sent_back" })
  })

  it("the server took it: the row says so for a moment, then leaves, then is gone", () => {
    const decided = decisionStep(pending, { type: "taken" })
    expect(decided).toEqual({ phase: "decided", decision: "approved" })
    const leaving = decisionStep(decided, { type: "shown" })
    expect(leaving).toEqual({ phase: "leaving", decision: "approved" })
    expect(decisionStep(leaving, { type: "left" })).toEqual({ phase: "gone" })
  })

  it("it failed: the row keeps the message, and a second click tries again", () => {
    const refused = decisionStep({ phase: "pending", decision: "sent_back" }, { type: "refused", message: "Can't reach the Cello server" })
    expect(refused).toEqual(failed)
    expect(decisionStep(failed, { type: "clicked", decision: "approved" })).toEqual(pending)
  })

  it("anything out of turn changes nothing: a second click while pending doesn't decide twice", () => {
    expect(decisionStep(pending, { type: "clicked", decision: "sent_back" })).toBe(pending)
    expect(decisionStep(IDLE, { type: "taken" })).toBe(IDLE)
    expect(decisionStep(IDLE, { type: "shown" })).toBe(IDLE)
    expect(decisionStep(failed, { type: "left" })).toBe(failed)
    const decided: DecisionState = { phase: "decided", decision: "approved" }
    expect(decisionStep(decided, { type: "left" })).toBe(decided)
    expect(decisionStep(decided, { type: "clicked", decision: "sent_back" })).toBe(decided)
  })
})

describe("withHeld: a decided row stays where it was until it has left, though the events took it off the queue (CEL-187)", () => {
  const keyOf = (key: string) => key
  const held = (key: string, at: number, phase: "decided" | "leaving") => ({ key, item: key, at, state: { phase, decision: "approved" } as const })

  it("the queue as it is, with nothing decided", () => {
    expect(withHeld(["CEL-3", "CEL-7"], keyOf, [])).toEqual(["CEL-3", "CEL-7"])
  })

  it("a decided row the queue dropped is still shown, in its place", () => {
    expect(withHeld(["CEL-3", "THAI-2"], keyOf, [held("CEL-7", 1, "decided")])).toEqual(["CEL-3", "CEL-7", "THAI-2"])
    expect(withHeld(["CEL-7", "THAI-2"], keyOf, [held("CEL-3", 0, "decided")])).toEqual(["CEL-3", "CEL-7", "THAI-2"])
    expect(withHeld([], keyOf, [held("CEL-3", 4, "decided")])).toEqual(["CEL-3"])
  })

  it("two rows decided one after the other both keep their place", () => {
    expect(withHeld(["THAI-2"], keyOf, [held("CEL-7", 1, "decided"), held("CEL-3", 0, "decided")])).toEqual(["CEL-3", "CEL-7", "THAI-2"])
  })

  it("a row the queue still lists (its events haven't arrived) is shown once", () => {
    expect(withHeld(["CEL-3", "CEL-7"], keyOf, [held("CEL-7", 1, "decided")])).toEqual(["CEL-3", "CEL-7"])
  })

  it("a leaving row is out of the list, so it can fold away, even while the queue still lists it", () => {
    expect(withHeld(["CEL-3", "THAI-2"], keyOf, [held("CEL-7", 1, "leaving")])).toEqual(["CEL-3", "THAI-2"])
    expect(withHeld(["CEL-3", "CEL-7"], keyOf, [held("CEL-7", 1, "leaving")])).toEqual(["CEL-3"])
  })
})

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
