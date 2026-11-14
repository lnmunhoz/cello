import { describe, expect, it } from "vitest"
import { findMove } from "./moves.ts"

describe("findMove", () => {
  it("finds a card moved to another column", () => {
    expect(findMove({ todo: ["a", "b"], done: ["c"] }, { todo: ["b"], done: ["c", "a"] })).toEqual({ key: "a", to: "done", index: 1 })
  })

  it("finds a card moved within its column", () => {
    expect(findMove({ todo: ["a", "b", "c"] }, { todo: ["b", "c", "a"] })).toEqual({ key: "a", to: "todo", index: 2 })
    expect(findMove({ todo: ["a", "b", "c"] }, { todo: ["c", "a", "b"] })).toEqual({ key: "c", to: "todo", index: 0 })
  })

  it("prefers the key the drag reports", () => {
    expect(findMove({ todo: ["a", "b"] }, { todo: ["b", "a"] }, "b")).toEqual({ key: "b", to: "todo", index: 0 })
  })

  it("returns null when nothing moved", () => {
    expect(findMove({ todo: ["a"] }, { todo: ["a"] })).toBeNull()
  })
})
