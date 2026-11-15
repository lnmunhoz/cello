import { describe, expect, it } from "vitest"
import { COMPARE_LAYOUT_KEY, columnsFor, readCompareLayout } from "./compare.ts"

describe("the full-screen compare view of a question", () => {
  it("opens in columns unless rows was chosen on this device", () => {
    expect(readCompareLayout(null)).toBe("columns")
    expect(readCompareLayout("columns")).toBe("columns")
    expect(readCompareLayout("rows")).toBe("rows")
    expect(readCompareLayout("sideways")).toBe("columns")
    expect(COMPARE_LAYOUT_KEY).toBe("cello:ask-compare-layout")
  })

  it("puts up to four options side by side, and wraps more into balanced rows of at most four", () => {
    expect([1, 2, 3, 4].map(columnsFor)).toEqual([1, 2, 3, 4])
    // 5 → 3 + 2, 6 → 3 + 3, 7 → 4 + 3, 8 → 4 + 4, 9 → 3 + 3 + 3
    expect([5, 6, 7, 8, 9].map(columnsFor)).toEqual([3, 3, 4, 4, 3])
    expect(columnsFor(0)).toBe(1)
  })
})
