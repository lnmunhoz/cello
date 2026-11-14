import { describe, expect, it } from "vitest"
import {
  clampPanelWidth,
  DEFAULT_WINDOW_SIZE,
  EDGE_WIDTH,
  isTogglePanelShortcut,
  layoutViews,
  parseWindowState,
  restoreBounds,
  TOOLBAR_HEIGHT,
} from "./layout.ts"

describe("layoutViews", () => {
  it("gives the board the whole window while the panel is closed", () => {
    expect(layoutViews({ width: 1280, height: 800, panelOpen: false, panelWidth: 500 })).toEqual({
      board: { x: 0, y: 0, width: 1280, height: 800 },
      chrome: null,
      page: null,
    })
  })

  it("docks the panel on the right: its chrome (edge + toolbar) behind, the page below the toolbar", () => {
    const { board, chrome, page } = layoutViews({ width: 1280, height: 800, panelOpen: true, panelWidth: 500 })
    expect(board).toEqual({ x: 0, y: 0, width: 780, height: 800 })
    expect(chrome).toEqual({ x: 780, y: 0, width: 500, height: 800 })
    expect(page).toEqual({ x: 780 + EDGE_WIDTH, y: TOOLBAR_HEIGHT, width: 500 - EDGE_WIDTH, height: 800 - TOOLBAR_HEIGHT })
  })
})

describe("clampPanelWidth", () => {
  it("keeps the panel and the board both usable", () => {
    expect(clampPanelWidth(500, 1280)).toBe(500)
    expect(clampPanelWidth(100, 1280)).toBe(320)
    expect(clampPanelWidth(1200, 1280)).toBe(1280 - 400)
  })

  it("splits a window too narrow for both minimums in half", () => {
    expect(clampPanelWidth(500, 600)).toBe(300)
  })
})

describe("window state", () => {
  it("restores saved bounds that fit on a connected display", () => {
    const saved = { x: 100, y: 50, width: 1200, height: 800 }
    expect(restoreBounds(saved, [{ x: 0, y: 0, width: 1512, height: 982 }])).toEqual(saved)
  })

  it("uses the default size when the saved bounds are off every display", () => {
    const saved = { x: 3000, y: 50, width: 1200, height: 800 }
    expect(restoreBounds(saved, [{ x: 0, y: 0, width: 1512, height: 982 }])).toEqual(DEFAULT_WINDOW_SIZE)
    expect(restoreBounds(undefined, [{ x: 0, y: 0, width: 1512, height: 982 }])).toEqual(DEFAULT_WINDOW_SIZE)
  })

  it("reads the saved state, falling back to defaults for anything missing or broken", () => {
    const bounds = { x: 1, y: 2, width: 1000, height: 700 }
    expect(parseWindowState(JSON.stringify({ bounds, maximized: true, panelWidth: 640 }))).toEqual({ bounds, maximized: true, panelWidth: 640 })
    expect(parseWindowState("{oops")).toEqual({ maximized: false, panelWidth: 560 })
    expect(parseWindowState(JSON.stringify({ bounds: { x: "a" }, panelWidth: -3 }))).toEqual({ maximized: false, panelWidth: 560 })
    expect(parseWindowState(null)).toEqual({ maximized: false, panelWidth: 560 })
  })
})

describe("isTogglePanelShortcut", () => {
  const key = (over: Partial<Parameters<typeof isTogglePanelShortcut>[0]>) =>
    ({ type: "keyDown", key: "\\", code: "Backslash", meta: false, control: false, alt: false, shift: false, ...over }) as const

  it("is ⌘\\ on macOS", () => {
    expect(isTogglePanelShortcut(key({ meta: true }), "darwin")).toBe(true)
    expect(isTogglePanelShortcut(key({ meta: true, key: "«" }), "darwin")).toBe(true)
    expect(isTogglePanelShortcut(key({}), "darwin")).toBe(false)
    expect(isTogglePanelShortcut(key({ meta: true, shift: true }), "darwin")).toBe(false)
    expect(isTogglePanelShortcut(key({ meta: true, type: "keyUp" }), "darwin")).toBe(false)
  })

  it("is Ctrl+\\ elsewhere", () => {
    expect(isTogglePanelShortcut(key({ control: true }), "linux")).toBe(true)
    expect(isTogglePanelShortcut(key({ meta: true }), "linux")).toBe(false)
  })
})
