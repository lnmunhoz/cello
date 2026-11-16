import { describe, expect, it } from "vitest"
import { groupingOf, groupSearch, layoutOf, orderingKey, orderingOf, orderSearch, parseIssuesSearch, searchFor } from "./layout.ts"

describe("issues layout in the URL", () => {
  it("reads ?layout=list, and anything else as the board", () => {
    expect(parseIssuesSearch({ layout: "list" })).toEqual({ layout: "list" })
    expect(parseIssuesSearch({ layout: "board" })).toEqual({})
    expect(parseIssuesSearch({ layout: "table" })).toEqual({})
    expect(parseIssuesSearch({})).toEqual({})
  })

  it("keeps other search params out of the issues search", () => {
    expect(parseIssuesSearch({ layout: "list", view: "x" })).toEqual({ layout: "list" })
  })

  it("keeps the filter's params beside the layout (CEL-52), and drops values it doesn't know", () => {
    expect(parseIssuesSearch({ layout: "list", label: "bug,agents", who: "agent,martian", q: "drag" })).toEqual({
      layout: "list",
      label: "bug,agents",
      who: "agent",
      q: "drag",
    })
  })

  it("reads ?group=milestone (CEL-132), the board's swimlanes by milestone; status is the default and has no param", () => {
    expect(parseIssuesSearch({ group: "milestone" })).toEqual({ group: "milestone" })
    expect(parseIssuesSearch({ group: "status" })).toEqual({})
    expect(parseIssuesSearch({ group: "label" })).toEqual({})
    expect(groupingOf({ group: "milestone" })).toBe("milestone")
    expect(groupingOf({ group: "milestone", layout: "list" })).toBe("status")
    expect(groupingOf({})).toBe("status")
    expect(groupSearch("status")).toEqual({ group: undefined })
    expect(groupSearch("milestone")).toEqual({ group: "milestone" })
  })

  it("names the layout a search shows", () => {
    expect(layoutOf({ layout: "list" })).toBe("list")
    expect(layoutOf({})).toBe("board")
  })

  it("writes the board as no param, so a plain link opens the board", () => {
    expect(searchFor("list")).toMatchObject({ layout: "list" })
    expect(searchFor("board")).toMatchObject({ layout: undefined })
  })

  it("drops ?order when switching layout, so the other layout shows its own saved ordering", () => {
    expect(searchFor("list")).toEqual({ layout: "list", order: undefined })
    expect(searchFor("board")).toEqual({ layout: undefined, order: undefined })
  })
})

describe("issues ordering: the URL, then this device's choice for the project and layout", () => {
  it("reads a known ?order and drops anything else", () => {
    expect(parseIssuesSearch({ order: "newest" })).toEqual({ order: "newest" })
    expect(parseIssuesSearch({ layout: "list", order: "priority" })).toEqual({ layout: "list", order: "priority" })
    expect(parseIssuesSearch({ order: "random" })).toEqual({})
  })

  it("the URL wins, then the saved choice, then manual", () => {
    expect(orderingOf({ order: "due" }, "newest")).toBe("due")
    expect(orderingOf({}, "newest")).toBe("newest")
    expect(orderingOf({}, "garbage")).toBe("manual")
    expect(orderingOf({}, null)).toBe("manual")
  })

  it("is saved per project and layout", () => {
    expect(orderingKey("cel", "board")).toBe("cello:order:CEL:board")
    expect(orderingKey("CEL", "list")).toBe("cello:order:CEL:list")
  })

  it("writes manual as no param, so a plain link shows the drag order", () => {
    expect(orderSearch("newest")).toEqual({ order: "newest" })
    expect(orderSearch("manual")).toEqual({ order: undefined })
  })
})
