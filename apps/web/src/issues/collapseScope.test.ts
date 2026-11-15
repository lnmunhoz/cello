// CEL-52 scope (removed in the real build): the pure parts of the three ways to collapse the filter panel.
import { EMPTY_FILTER, type TaskFilter } from "@cello/client/sync/filters"
import { describe, expect, it } from "vitest"
import { activeChips, foldedKeys, toggleFold } from "./collapseScope.ts"

const names = { labels: new Map([["bug", { name: "bug", color: "#f00" }], ["agents", { name: "agents", color: "#0f0" }]]), sessions: new Map(), me: "Lucas" }

describe("the active filters as chips", () => {
  it("lists one chip per value, labels first, each removing only itself", () => {
    const f: TaskFilter = { ...EMPTY_FILTER, labels: ["bug", "agents"], holder: ["nobody"], priority: [1], text: "drag" }
    const chips = activeChips(f, names)
    expect(chips.map((c) => [c.field, c.name])).toEqual([
      [null, "bug"],
      [null, "agents"],
      ["Working on it", "Nobody"],
      ["Priority", "Urgent"],
      ["Text", "“drag”"],
    ])
    expect(chips[0]!.color).toBe("#f00")
    expect(chips[0]!.remove(f).labels).toEqual(["agents"])
    expect(chips[2]!.remove(f).holder).toEqual([])
    expect(chips[4]!.remove(f).text).toBe("")
  })

  it("has none without a filter", () => {
    expect(activeChips(EMPTY_FILTER, names)).toEqual([])
  })
})

describe("folded sections", () => {
  it("reads the kept list, and folds or unfolds one key", () => {
    expect(foldedKeys(null)).toEqual([])
    expect(foldedKeys("not json")).toEqual([])
    expect(foldedKeys('["area"]')).toEqual(["area"])
    expect(toggleFold(["area"], "holder")).toEqual(["area", "holder"])
    expect(toggleFold(["area", "holder"], "area")).toEqual(["holder"])
  })
})
