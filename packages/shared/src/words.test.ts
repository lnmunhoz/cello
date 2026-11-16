import { describe, expect, it } from "vitest"
import { andList, closeMatches } from "./words.ts"

describe("andList", () => {
  it.each([
    [[], ""],
    [["Lucas"], "Lucas"],
    [["Lucas", "2fd0505c"], "Lucas and 2fd0505c"],
    [["a", "b", "c"], "a, b and c"],
  ])("%j reads %j", (items, text) => {
    expect(andList(items)).toBe(text)
  })
})

describe("closeMatches", () => {
  const names = ["board", "bug", "task-panel", "tests", "release", "review", "pages", "agents"]

  it("finds names a typo or a part away, closest first", () => {
    expect(closeMatches("bord", names)).toEqual(["board"])
    expect(closeMatches("panel", names)).toEqual(["task-panel"])
    expect(closeMatches("test", names)).toEqual(["tests"])
    expect(closeMatches("reveiw", names)).toEqual(["review"])
  })

  it("finds nothing for a name unlike any", () => {
    expect(closeMatches("zebra", names)).toEqual([])
  })
})
