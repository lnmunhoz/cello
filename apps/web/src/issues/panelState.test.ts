import { EMPTY_FILTER, type TaskFilter } from "@cello/client/sync/filters"
import { describe, expect, it } from "vitest"
import { foldedKeys, isPanelOpen, panelValue, pickedValues, toggleFold } from "./panelState.ts"

const names = {
  labels: new Map([["bug", "bug"], ["agents", "agents"], ["someday", "Someday"]]),
  milestones: new Map([["m3", "M3"]]),
  sessions: new Map([["s1", "Claude Code · 8a41c9e2"]]),
  me: "Lucas",
}

describe("the panel, open or folded to the rail", () => {
  it("is open unless this device kept it as the rail", () => {
    expect(isPanelOpen(null)).toBe(true)
    expect(isPanelOpen("open")).toBe(true)
    expect(isPanelOpen("rail")).toBe(false)
    expect(isPanelOpen("nonsense")).toBe(true)
  })

  it("keeps open and rail as words", () => {
    expect(panelValue(true)).toBe("open")
    expect(panelValue(false)).toBe("rail")
    expect(isPanelOpen(panelValue(false))).toBe(false)
  })
})

describe("folded sections", () => {
  it("reads the kept list, ignoring anything that isn't a list of keys", () => {
    expect(foldedKeys(null)).toEqual([])
    expect(foldedKeys("not json")).toEqual([])
    expect(foldedKeys('{"area":true}')).toEqual([])
    expect(foldedKeys('["group-area", 3, "holder"]')).toEqual(["group-area", "holder"])
  })

  it("folds a key, and unfolds it again, keeping the others", () => {
    expect(toggleFold([], "group-area")).toEqual(["group-area"])
    expect(toggleFold(["group-area"], "holder")).toEqual(["group-area", "holder"])
    expect(toggleFold(["group-area", "holder"], "group-area")).toEqual(["holder"])
  })
})

describe("what's picked, for the rail's count and a folded heading", () => {
  it("names each value on, with its section, labels first and as written", () => {
    const f: TaskFilter = {
      ...EMPTY_FILTER,
      labels: ["bug", "someday"],
      milestones: ["m3", "none"],
      holder: ["nobody", "human"],
      sessions: ["s1"],
      priority: [1],
      due: ["overdue"],
      updated: "day",
      text: " drag ",
    }
    expect(pickedValues(f, names)).toEqual([
      { field: "labels", name: "bug" },
      { field: "labels", name: "Someday" },
      { field: "milestones", name: "M3" },
      { field: "milestones", name: "No milestone" },
      { field: "holder", name: "Nobody" },
      { field: "holder", name: "Lucas" },
      { field: "holder", name: "Claude Code · 8a41c9e2" },
      { field: "priority", name: "Urgent" },
      { field: "due", name: "Overdue" },
      { field: "updated", name: "In the last 24 hours" },
      { field: "text", name: "“drag”" },
    ])
  })

  it("counts nothing without a filter", () => {
    expect(pickedValues(EMPTY_FILTER, names)).toEqual([])
  })
})
