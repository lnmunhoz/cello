import { describe, expect, it } from "vitest"
import { dropOf, findMove, indexAmong } from "./moves.ts"

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

describe("indexAmong: where a drop among the shown cards lands among all of them (CEL-52)", () => {
  // The column holds p, q, r, s; a filter shows only q and s.
  const column = [at("p", "a0"), at("q", "a1"), at("r", "a2"), at("s", "a3")]

  it("unfiltered, it's the drop's own index", () => {
    expect(indexAmong(["p", "x", "q", "r", "s"], { key: "x", to: "todo", index: 1 }, column)).toBe(1)
    expect(indexAmong(["x", "p", "q", "r", "s"], { key: "x", to: "todo", index: 0 }, column)).toBe(0)
    expect(indexAmong(["p", "q", "r", "s", "x"], { key: "x", to: "todo", index: 4 }, column)).toBe(4)
    expect(indexAmong(["x"], { key: "x", to: "todo", index: 0 }, [])).toBe(0)
  })

  it("filtered, the card goes right after the shown card above it, or right before the one below", () => {
    expect(indexAmong(["q", "x", "s"], { key: "x", to: "todo", index: 1 }, column)).toBe(2)
    expect(indexAmong(["q", "s", "x"], { key: "x", to: "todo", index: 2 }, column)).toBe(4)
    expect(indexAmong(["x", "q", "s"], { key: "x", to: "todo", index: 0 }, column)).toBe(1)
    // Alone in what's shown: to the end.
    expect(indexAmong(["x"], { key: "x", to: "todo", index: 0 }, column)).toBe(4)
  })

  it("cards shown in the column that aren't its own (folded Needs input) are skipped", () => {
    expect(indexAmong(["p", "q", "r", "s", "w", "x"], { key: "x", to: "todo", index: 5 }, column)).toBe(4)
    expect(dropOf({ key: "x", to: "todo", index: indexAmong(["q", "x", "s"], { key: "x", to: "todo", index: 1 }, column) }, "todo", "manual", column))
      .toMatchObject({ before: "q", after: "r" })
  })
})
