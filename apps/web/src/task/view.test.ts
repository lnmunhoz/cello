import { describe, expect, it } from "vitest"
import { behindTask, parseTaskSearch, searchForView, taskViewOf, toggledView } from "./view.ts"

describe("an open task's view in the URL", () => {
  it("reads ?view=full, and anything else as the side panel", () => {
    expect(parseTaskSearch({ view: "full" })).toEqual({ view: "full" })
    expect(parseTaskSearch({ view: "panel" })).toEqual({})
    expect(parseTaskSearch({ view: "wide" })).toEqual({})
    expect(parseTaskSearch({})).toEqual({})
  })

  it("keeps other search params out of the task search", () => {
    expect(parseTaskSearch({ view: "full", embed: 1, layout: "list" })).toEqual({ view: "full" })
  })

  it("names the view a search shows", () => {
    expect(taskViewOf({ view: "full" })).toBe("full")
    expect(taskViewOf({})).toBe("panel")
  })

  it("writes the panel as no param, so a plain task link opens the panel", () => {
    expect(searchForView("full")).toEqual({ view: "full" })
    expect(searchForView("panel")).toEqual({ view: undefined })
  })

  it("hides the board or list behind a full page, and behind the panel only in a narrow window", () => {
    expect(behindTask(false, "panel")).toBe("")
    expect(behindTask(false, "full")).toBe("")
    expect(behindTask(true, "panel")).toBe("max-md:hidden")
    expect(behindTask(true, "full")).toBe("hidden")
  })

  it("toggles between the two", () => {
    expect(toggledView("panel")).toBe("full")
    expect(toggledView("full")).toBe("panel")
  })
})
