import { describe, expect, it } from "vitest"
import { BASELINE_MS, drawnMarks } from "./drawnMarks.ts"

describe("drawnMarks (CEL-69)", () => {
  it("hands a card moving column what its old self drew: the new one mounts while the old is still on screen", () => {
    const marks = drawnMarks<string>()
    marks.seen("t1", "working")
    // The new card's first render runs before the old card unmounts.
    expect(marks.baseline("t1", 10_000)).toBe("working")
    marks.left("t1", 10_000)
    // Or a moment after it went, within the baseline's lifetime.
    expect(marks.baseline("t1", 10_000 + BASELINE_MS)).toBe("working")
  })

  it("forgets a card that's been off screen for longer: coming back to the board after a while plays nothing", () => {
    const marks = drawnMarks<string>()
    marks.seen("t1", "working")
    marks.left("t1", 0)
    expect(marks.baseline("t1", BASELINE_MS + 1)).toBeUndefined()
    expect(marks.baseline("t2", 0)).toBeUndefined()
  })

  it("keeps a card that's on screen however long ago it was drawn, until it leaves", () => {
    const marks = drawnMarks<string>()
    marks.seen("t1", "thinking")
    expect(marks.baseline("t1", 10 * 60_000)).toBe("thinking")
    marks.seen("t1", "working")
    expect(marks.baseline("t1", 10 * 60_000)).toBe("working")
  })

  it("prunes cards gone longer than the lifetime whenever one leaves, so the memory stays the size of the screen", () => {
    const marks = drawnMarks<string>()
    for (const id of ["a", "b", "c"]) marks.seen(id, "still")
    marks.left("a", 0)
    marks.left("b", 0)
    expect(marks.size()).toBe(3)
    marks.left("c", BASELINE_MS + 1)
    // a and b went long ago; c just left; nothing on screen is dropped.
    expect(marks.size()).toBe(1)
    marks.seen("d", "still")
    marks.left("c", 10 * BASELINE_MS)
    expect(marks.size()).toBe(2)
  })
})
