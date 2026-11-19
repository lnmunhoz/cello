import { describe, expect, it } from "vitest"
import { andList, closeMatches, plural } from "./words.ts"

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

describe("plural", () => {
  it("counts with the word, adding an s unless there is exactly one", () => {
    expect(plural(1, "file")).toBe("1 file")
    expect(plural(3, "command")).toBe("3 commands")
    expect(plural(0, "file")).toBe("0 files")
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
