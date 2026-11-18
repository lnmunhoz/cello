import type { Project } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { parseProjectPick, parseSort, projectChips, viewKey } from "./queueView.ts"

const project = (id: string, key: string, name: string): Project => ({ id, key, name }) as Project
const a = project("pa", "AAA", "Alpha")
const b = project("pb", "BBB", "Beta")
const c = project("pc", "CCC", "Gamma")

describe("projectChips", () => {
  it("is All with the total, then each project that has a row, with its count, in the order given", () => {
    expect(projectChips(["pa", "pb", "pa"], [a, b, c], null)).toEqual({
      all: 3,
      chips: [
        { project: a, count: 2 },
        { project: b, count: 1 },
      ],
    })
  })

  it("counts a row with no project in All only", () => {
    expect(projectChips(["pa", null], [a, b], null)).toEqual({ all: 2, chips: [{ project: a, count: 1 }] })
  })

  it("keeps a picked project in the row even with no rows, so the pick can be undone", () => {
    expect(projectChips(["pa"], [a, b], b)).toEqual({ all: 1, chips: [{ project: a, count: 1 }, { project: b, count: 0 }] })
  })
})

describe("parseProjectPick", () => {
  it("reads a stored project key", () => {
    expect(parseProjectPick("BBB", [a, b])).toBe(b)
  })

  it("is All for nothing stored, All, or a key that isn't a project of this workspace", () => {
    expect(parseProjectPick(null, [a, b])).toBeNull()
    expect(parseProjectPick("all", [a, b])).toBeNull()
    expect(parseProjectPick("ZZZ", [a, b])).toBeNull()
  })
})

describe("viewKey", () => {
  it("keeps one setting per page", () => {
    expect(viewKey("agents", "project")).toBe("cello:agents:project")
    expect(viewKey("review", "project")).toBe("cello:review:project")
    expect(viewKey("review", "sort")).toBe("cello:review:sort")
  })
})

describe("parseSort", () => {
  const sorts = ["oldest", "newest", "priority"] as const

  it("reads a saved sort the page offers", () => {
    expect(parseSort("priority", sorts)).toBe("priority")
  })

  it("is the page's first sort for nothing saved, or one it doesn't offer (another page's, an old value)", () => {
    expect(parseSort(null, sorts)).toBe("oldest")
    expect(parseSort("started", sorts)).toBe("oldest")
  })
})
