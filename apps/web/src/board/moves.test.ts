import { describe, expect, it } from "vitest"
import { dropOf, findMove } from "./moves.ts"

const at = (id: string, position: string) => ({ id, position })

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

describe("dropOf: what a drop changes", () => {
  const done = [at("c", "a0"), at("d", "a2")]

  it("in manual order, puts the card between its new neighbors", () => {
    expect(dropOf({ key: "a", to: "done", index: 1 }, "todo", "manual", done)).toMatchObject({ statusId: "done", before: "c", after: "d" })
    expect(dropOf({ key: "a", to: "todo", index: 0 }, "todo", "manual", done)).toMatchObject({ statusId: "todo", before: null, after: "c" })
  })

  it("in any other order, a drop on another column changes the status and appends, wherever it was dropped", () => {
    const drop = dropOf({ key: "a", to: "done", index: 0 }, "todo", "priority", done)
    expect(drop).toMatchObject({ statusId: "done", before: null, after: null })
    expect(drop!.position > "a2").toBe(true)
  })

  it("in any other order, a drop within its own column changes nothing: the order places it", () => {
    expect(dropOf({ key: "a", to: "todo", index: 0 }, "todo", "newest", done)).toBeNull()
  })
})
