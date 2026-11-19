import { describe, expect, it } from "vitest"
import { isRecord } from "./record.ts"

describe("isRecord", () => {
  it("is true for a plain object, an empty one and one made without a prototype", () => {
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord({})).toBe(true)
    expect(isRecord(Object.create(null))).toBe(true)
  })

  it("is false for null, arrays and everything that isn't an object", () => {
    for (const value of [null, undefined, [], [1], "text", 3, true, () => 1]) expect(isRecord(value)).toBe(false)
  })
})
