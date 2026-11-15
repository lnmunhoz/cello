import { describe, expect, it } from "vitest"
import { closeHole, withHoles, type Hole } from "./holes.ts"

const hole = (id: number, card: string, after: string | null, index = 0): Hole => ({ id, card, statusId: "todo", after, index, hidden: false })
const keys = (slots: ReturnType<typeof withHoles>) => slots.map((s) => (s.hole ? `(${s.key})` : s.key))

describe("withHoles", () => {
  it("puts a hole back after the card it followed", () => {
    expect(keys(withHoles(["a", "c"], [hole(1, "b", "a")]))).toEqual(["a", "(b)", "c"])
  })

  it("puts a hole that was first at the top", () => {
    expect(keys(withHoles(["a"], [hole(1, "x", null)]))).toEqual(["(x)", "a"])
  })

  it("places a hole that followed another hole", () => {
    expect(keys(withHoles(["a", "d"], [hole(2, "c", "b"), hole(1, "b", "a")]))).toEqual(["a", "(b)", "(c)", "d"])
  })

  it("falls back to the recorded index when the card it followed is gone", () => {
    expect(keys(withHoles(["a", "b", "c"], [hole(1, "x", "gone", 1)]))).toEqual(["a", "(x)", "b", "c"])
  })

  it("closing a hole hands the holes that followed it its own place, so they don't jump", () => {
    // Three of a column's cards moved away one after another: b's hole follows a's, c's follows b's.
    const holes = [hole(1, "a", null, 0), hole(2, "b", "a", 1), hole(3, "c", "b", 2)]
    const closed = closeHole(holes, 1)
    expect(closed.map((h) => [h.id, h.after])).toEqual([
      [2, null],
      [3, "b"],
    ])
    // Still above the cards that stayed, as before.
    expect(keys(withHoles(["d", "e"], closed))).toEqual(["(b)", "(c)", "d", "e"])
  })

  it("leaves a column without holes as it is", () => {
    expect(keys(withHoles(["a", "b"], []))).toEqual(["a", "b"])
  })
})
