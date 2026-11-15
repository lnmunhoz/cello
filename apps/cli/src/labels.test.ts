// Labels in the CLI (CEL-56): `task label`'s +name/-name changes, close matches for a typo, and `label list`'s text.
import type { Label } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { closeMatches, labelArgs, labelListText, parseChanges, parseGroup, resolveChanges } from "./labels.ts"

const label = (name: string, color = "#3B82F6", archivedAt: number | null = null): Label => ({
  id: `id-${name}`,
  workspaceId: "w",
  name,
  color,
  group: "none",
  createdAt: 0,
  updatedAt: 0,
  archivedAt,
})

describe("labelArgs", () => {
  it("keeps -name changes from being read as flags, wherever --json goes", () => {
    expect(labelArgs(["task", "label", "CEL-1", "+board", "-ui", "--json"])).toEqual(["task", "label", "--json", "CEL-1", "--", "+board", "-ui"])
    expect(labelArgs(["task", "label", "--json", "CEL-1", "-task-panel"])).toEqual(["task", "label", "--json", "CEL-1", "--", "-task-panel"])
  })

  it("leaves other commands, help, and arguments that already have -- alone", () => {
    expect(labelArgs(["task", "list", "--label", "ui"])).toEqual(["task", "list", "--label", "ui"])
    expect(labelArgs(["task", "label", "--help"])).toEqual(["task", "label", "--help"])
    expect(labelArgs(["task", "label", "CEL-1", "--", "-ui"])).toEqual(["task", "label", "CEL-1", "--", "-ui"])
  })
})

describe("parseChanges", () => {
  it("reads +name as add and -name as remove, ignoring case and repeats", () => {
    expect(parseChanges(["+Board", "-ui", "+cli", "+board"])).toEqual({ add: ["board", "cli"], remove: ["ui"] })
  })

  it("refuses a change without + or -, a bare sign, or nothing at all", () => {
    expect(parseChanges(["board"])).toBe(`Each change starts with + to add a label or - to remove one, e.g. +board -ui; "board" has neither.`)
    expect(parseChanges(["+"])).toBe(`"+" names no label: write +board to add board.`)
    expect(parseChanges([])).toBe("Say which labels to add and remove, e.g. `cello task label CEL-12 +board -ui`.")
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

describe("resolveChanges", () => {
  const labels = [label("board"), label("cli"), label("ui"), label("feature")]

  it("turns names into ids, in the labels' own spelling", () => {
    expect(resolveChanges({ add: ["Board", "cli"], remove: ["ui"] }, labels)).toEqual({ add: [labels[0]!, labels[1]!], remove: [labels[2]!] })
  })

  it("refuses unknown names, all of them at once, with close matches; nothing is created", () => {
    expect(resolveChanges({ add: ["bord", "zebra"], remove: [] }, labels)).toBe(
      `No label named "bord" (did you mean board?) and none named "zebra". Nothing was changed. ` +
        "Labels: board, cli, ui, feature. Make a new one with `cello label create <name>`.",
    )
    expect(resolveChanges({ add: [], remove: ["fetaure"] }, labels)).toBe(
      `No label named "fetaure" (did you mean feature?). Nothing was changed. ` +
        "Labels: board, cli, ui, feature. Make a new one with `cello label create <name>`.",
    )
  })
})

describe("labelListText", () => {
  it("lists live labels with colour and task counts, then the archived ones", () => {
    const text = labelListText({
      project: { key: "CEL" } as never,
      labels: [
        { label: label("board", "#5B9A74"), tasks: 9, otherProjects: 2 },
        { label: label("feature", "#3B82F6"), tasks: 1, otherProjects: 0 },
        { label: label("idle", "#6B7280"), tasks: 0, otherProjects: 0 },
        { label: label("ui", "#3B82F6", 1), tasks: 31, otherProjects: 0 },
      ],
    })
    expect(text).toBe([
      "board    #5B9A74  9 tasks in CEL · 2 in other projects",
      "feature  #3B82F6  1 task in CEL",
      "idle     #6B7280  no tasks",
      "",
      "Archived (hidden from cards and pickers; tasks keep the link): ui (31 tasks in CEL)",
    ].join("\n"))
  })

  it("says when there are none yet", () => {
    expect(labelListText({ project: { key: "CEL" } as never, labels: [] })).toBe(
      "No labels yet in CEL's workspace. Make one with `cello label create <name> --color #3B82F6`.",
    )
  })

  it("heads each group once any label has one (CEL-52): kind, area, milestone, then the rest, columns lined up across them", () => {
    const grouped = (name: string, group: Label["group"]) => ({ label: { ...label(name), group }, tasks: 1, otherProjects: 0 })
    const text = labelListText({
      project: { key: "CEL" } as never,
      labels: [grouped("M2", "milestone"), grouped("agents", "area"), grouped("bug", "kind"), grouped("feature", "kind"), grouped("misc", "none")],
    })
    expect(text).toBe([
      "Kind",
      "  bug      #3B82F6  1 task in CEL",
      "  feature  #3B82F6  1 task in CEL",
      "",
      "Area",
      "  agents   #3B82F6  1 task in CEL",
      "",
      "Milestone",
      "  M2       #3B82F6  1 task in CEL",
      "",
      "No group",
      "  misc     #3B82F6  1 task in CEL",
    ].join("\n"))
  })
})

describe("parseGroup", () => {
  it("reads a group in any case, and names the groups for anything else", () => {
    expect(parseGroup("Area")).toBe("area")
    expect(parseGroup(" kind ")).toBe("kind")
    expect(parseGroup("theme")).toBe(`No group named "theme". Groups: kind, area, milestone, none. Nothing was changed.`)
  })
})
