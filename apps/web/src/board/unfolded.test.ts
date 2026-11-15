import { describe, expect, it } from "vitest"
import { readUnfolded, unfoldedKey } from "./unfolded.ts"

describe("the board's unfolded hidden columns, remembered on this device", () => {
  it("is saved per project", () => {
    expect(unfoldedKey("cel")).toBe("cello:board-unfolded:CEL")
  })

  it("reads back the saved status ids", () => {
    expect(readUnfolded(JSON.stringify(["s1", "s2"]))).toEqual(["s1", "s2"])
  })

  it("reads nothing saved, or anything broken, as none unfolded", () => {
    expect(readUnfolded(null)).toEqual([])
    expect(readUnfolded("not json")).toEqual([])
    expect(readUnfolded(JSON.stringify({ s1: true }))).toEqual([])
    expect(readUnfolded(JSON.stringify(["s1", 3, null]))).toEqual(["s1"])
  })
})
