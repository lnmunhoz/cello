import { describe, expect, it } from "vitest"
import { clampWidth } from "../lib/resize.ts"
import { behindTask, parseTaskSearch, searchForView, TASK_PANEL_WIDTH, taskPlacement, taskViewOf, toggledView, viewToggle } from "./view.ts"

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

  it("keeps the comment ⌘K opened it at (CEL-43)", () => {
    expect(parseTaskSearch({ comment: "01ABC" })).toEqual({ comment: "01ABC" })
    expect(parseTaskSearch({ view: "full", comment: "01ABC" })).toEqual({ view: "full", comment: "01ABC" })
    expect(parseTaskSearch({ comment: "" })).toEqual({})
    expect(parseTaskSearch({ comment: 5 })).toEqual({})
  })

  it("names the view a search shows", () => {
    expect(taskViewOf({ view: "full" })).toBe("full")
    expect(taskViewOf({})).toBe("panel")
  })

  it("writes the panel as no param, so a plain task link opens the panel", () => {
    expect(searchForView("full")).toEqual({ view: "full" })
    expect(searchForView("panel")).toEqual({ view: undefined })
  })

  it("hides the board or list behind a task in the main area, and behind the panel only in a narrow window", () => {
    expect(behindTask("none")).toBe("")
    expect(behindTask("side")).toBe("max-md:hidden")
    expect(behindTask("page")).toBe("hidden")
    // A narrow window: the viewer over the task, which already took the board's place.
    expect(behindTask("covered")).toBe("max-md:hidden")
  })

  it("toggles between the two", () => {
    expect(toggledView("panel")).toBe("full")
    expect(toggledView("full")).toBe("panel")
  })

  it("expand and collapse follow where the task is: in the main area beside the viewer, collapse closes the viewer too", () => {
    expect(viewToggle("side")).toEqual({ view: "full", closeViewer: false })
    expect(viewToggle("page")).toEqual({ view: "panel", closeViewer: true })
  })
})

describe("where the open task sits in the project layout", () => {
  it("docks on the right beside the board, as a page in its place when full, and nowhere without a task", () => {
    expect(taskPlacement(false, "panel", false)).toBe("none")
    expect(taskPlacement(false, "full", true)).toBe("none")
    expect(taskPlacement(true, "panel", false)).toBe("side")
    expect(taskPlacement(true, "full", false)).toBe("page")
  })

  it("with the viewer open, the task moves to the main area and the viewer sits beside it (CEL-117), never covering it", () => {
    expect(taskPlacement(true, "panel", true)).toBe("page")
    expect(taskPlacement(true, "full", true)).toBe("page")
  })

  it("in a narrow window (below 768 px) there's no room for both: the viewer covers the docked task, as before CEL-117", () => {
    expect(taskPlacement(true, "panel", true, true)).toBe("covered")
    expect(taskPlacement(true, "panel", false, true)).toBe("side")
    expect(taskPlacement(true, "full", true, true)).toBe("page")
    expect(taskPlacement(false, "panel", true, true)).toBe("none")
  })
})

describe("the docked panel's width", () => {
  it("starts at 560px, and stays between 360px and 960px", () => {
    expect(TASK_PANEL_WIDTH.initial).toBe(560)
    expect(clampWidth(100, TASK_PANEL_WIDTH, 2000)).toBe(360)
    expect(clampWidth(2000, TASK_PANEL_WIDTH, 2000)).toBe(960)
  })

  it("leaves the board or list at least 360px", () => {
    expect(clampWidth(2000, TASK_PANEL_WIDTH, 1190)).toBe(830)
    expect(clampWidth(700, TASK_PANEL_WIDTH, 1190)).toBe(700)
  })
})
