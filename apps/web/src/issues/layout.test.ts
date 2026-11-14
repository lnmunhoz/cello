import { describe, expect, it } from "vitest"
import { layoutOf, parseIssuesSearch, searchFor } from "./layout.ts"

describe("issues layout in the URL", () => {
  it("reads ?layout=list, and anything else as the board", () => {
    expect(parseIssuesSearch({ layout: "list" })).toEqual({ layout: "list" })
    expect(parseIssuesSearch({ layout: "board" })).toEqual({})
    expect(parseIssuesSearch({ layout: "table" })).toEqual({})
    expect(parseIssuesSearch({})).toEqual({})
  })

  it("keeps other search params out of the issues search", () => {
    expect(parseIssuesSearch({ layout: "list", q: "x" })).toEqual({ layout: "list" })
  })

  it("names the layout a search shows", () => {
    expect(layoutOf({ layout: "list" })).toBe("list")
    expect(layoutOf({})).toBe("board")
  })

  it("writes the board as no param, so a plain link opens the board", () => {
    expect(searchFor("list")).toEqual({ layout: "list" })
    expect(searchFor("board")).toEqual({ layout: undefined })
  })
})
