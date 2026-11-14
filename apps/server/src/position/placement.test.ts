import { describe, expect, it } from "vitest"
import { place } from "./placement.ts"

const column = [
  { id: "a", position: "a0" },
  { id: "b", position: "a1" },
  { id: "c", position: "a2" },
]

const placed = (result: ReturnType<typeof place>) => {
  if (result._tag !== "Placed") throw new Error(`expected Placed, got ${result._tag}`)
  return result
}

describe("place", () => {
  it("puts an item between its two neighbors", () => {
    const { position } = placed(place(column, { before: "a", after: "b" }))
    expect(position > "a0" && position < "a1").toBe(true)
  })

  it("puts an item at the top when only `after` is the first item", () => {
    const { position } = placed(place(column, { after: "a" }))
    expect(position < "a0").toBe(true)
  })

  it("puts an item at the bottom when only `before` is the last item, or with no neighbors", () => {
    expect(placed(place(column, { before: "c" })).position > "a2").toBe(true)
    expect(placed(place(column, {})).position > "a2").toBe(true)
  })

  it("places into an empty column", () => {
    expect(typeof placed(place([], {})).position).toBe("string")
  })

  it("with only one neighbor, sits right next to it", () => {
    const below = placed(place(column, { before: "a" })).position
    expect(below > "a0" && below < "a1").toBe(true)
    const above = placed(place(column, { after: "c" })).position
    expect(above > "a1" && above < "a2").toBe(true)
  })

  it("never lands on an item the caller didn't mention (e.g. an archived one in between)", () => {
    const { position } = placed(place(column, { before: "a", after: "c" }))
    expect(position > "a0" && position < "a1").toBe(true)
  })

  it("leaves an item where it is when it already sits between the neighbors", () => {
    const result = placed(place(column, { self: { id: "b", position: "a1" }, before: "a", after: "c" }))
    expect(result).toEqual({ _tag: "Placed", position: "a1", unchanged: true })
  })

  it("ignores the item itself when finding neighbors", () => {
    const { position, unchanged } = placed(place(column, { self: { id: "a", position: "a0" }, before: "c" }))
    expect(unchanged).toBe(false)
    expect(position > "a2").toBe(true)
  })

  it("rejects a neighbor that isn't in the group, the item itself, or neighbors out of order", () => {
    expect(place(column, { before: "zz" })).toEqual({ _tag: "BadNeighbor", field: "before", reason: "zz is not in this column" })
    expect(place(column, { self: { id: "a", position: "a0" }, after: "a" })._tag).toBe("BadNeighbor")
    expect(place(column, { before: "c", after: "a" })).toEqual({ _tag: "BadNeighbor", field: "after", reason: "c must come before a" })
  })
})
