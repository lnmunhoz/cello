import { describe, expect, it } from "vitest"
import { positionBetween, positionsAfter } from "./position.ts"

describe("positionBetween", () => {
  it("makes a first position when there are no neighbors", () => {
    expect(typeof positionBetween(null, null)).toBe("string")
  })

  it("places before the first, after the last, and between two", () => {
    const a = positionBetween(null, null)
    const before = positionBetween(null, a)
    const after = positionBetween(a, null)
    const between = positionBetween(a, after)
    expect(before < a).toBe(true)
    expect(after > a).toBe(true)
    expect(a < between && between < after).toBe(true)
  })

  it("keeps 1,000 random inserts in order", () => {
    const list: string[] = [positionBetween(null, null)]
    let seed = 42
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    for (let i = 0; i < 1000; i++) {
      const at = Math.floor(random() * (list.length + 1))
      const prev = at === 0 ? null : list[at - 1]!
      const next = at === list.length ? null : list[at]!
      list.splice(at, 0, positionBetween(prev, next))
    }
    expect([...list].sort()).toEqual(list)
    expect(new Set(list).size).toBe(list.length)
  })

  it("rejects neighbors in the wrong order", () => {
    const a = positionBetween(null, null)
    const b = positionBetween(a, null)
    expect(() => positionBetween(b, a)).toThrow()
  })
})

describe("positionsAfter", () => {
  it("makes n increasing positions after a given one", () => {
    const start = positionBetween(null, null)
    const list = positionsAfter(start, 5)
    expect(list).toHaveLength(5)
    expect([start, ...list]).toEqual([start, ...list].sort())
  })
})
