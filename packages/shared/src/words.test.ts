import { describe, expect, it } from "vitest"
import { andList } from "./words.ts"

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
