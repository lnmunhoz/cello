import { describe, expect, it } from "vitest"
import { clampWidth, readWidth } from "../lib/resize.ts"
import { DEFAULT_SIDEBAR, NARROW_WIDTH, readSidebar, setSidebarMode, shownSidebar, SIDEBAR_WIDTH, toggleSidebar, writeSidebar } from "./sidebarState.ts"

describe("the sidebar's state, remembered on this device", () => {
  it("starts expanded, collapsing to the rail", () => {
    expect(DEFAULT_SIDEBAR).toEqual({ mode: "expanded", collapsed: "rail" })
    expect(readSidebar(null)).toEqual(DEFAULT_SIDEBAR)
  })

  it("reads back what was written", () => {
    for (const state of [
      { mode: "rail", collapsed: "rail" },
      { mode: "hidden", collapsed: "hidden" },
      { mode: "expanded", collapsed: "hidden" },
    ] as const) {
      expect(readSidebar(writeSidebar(state))).toEqual(state)
    }
  })

  it("anything broken or unknown falls back to the default, field by field", () => {
    expect(readSidebar("not json")).toEqual(DEFAULT_SIDEBAR)
    expect(readSidebar("[]")).toEqual(DEFAULT_SIDEBAR)
    expect(readSidebar(JSON.stringify({ mode: "floating", collapsed: "sideways" }))).toEqual(DEFAULT_SIDEBAR)
    expect(readSidebar(JSON.stringify({ mode: "rail" }))).toEqual({ mode: "rail", collapsed: "rail" })
  })
})

describe("⌘B and the buttons", () => {
  it("⌘B collapses the expanded sidebar to the rail, and expands it again", () => {
    const rail = toggleSidebar(DEFAULT_SIDEBAR)
    expect(rail).toEqual({ mode: "rail", collapsed: "rail" })
    expect(toggleSidebar(rail)).toEqual(DEFAULT_SIDEBAR)
  })

  it("once hidden with the button, ⌘B toggles between expanded and hidden", () => {
    const hidden = setSidebarMode(toggleSidebar(DEFAULT_SIDEBAR), "hidden")
    expect(hidden).toEqual({ mode: "hidden", collapsed: "hidden" })
    const shown = toggleSidebar(hidden)
    expect(shown).toEqual({ mode: "expanded", collapsed: "hidden" })
    expect(toggleSidebar(shown)).toEqual(hidden)
  })

  it("collapsing to the rail with its button makes the rail what ⌘B collapses to again", () => {
    const shown = { mode: "expanded", collapsed: "hidden" } as const
    expect(setSidebarMode(shown, "rail")).toEqual({ mode: "rail", collapsed: "rail" })
  })

  it("expanding keeps what it collapses to", () => {
    expect(setSidebarMode({ mode: "hidden", collapsed: "hidden" }, "expanded")).toEqual({ mode: "expanded", collapsed: "hidden" })
  })
})

describe("shownSidebar: in a narrow window it starts as the rail, without saving that", () => {
  const narrow = { narrow: true, expandedHere: false }
  it("a narrow window shows an expanded sidebar as the rail; the saved state is untouched", () => {
    expect(NARROW_WIDTH).toBe(768)
    expect(shownSidebar(DEFAULT_SIDEBAR, narrow)).toEqual({ mode: "rail", collapsed: "rail" })
    expect(shownSidebar({ mode: "expanded", collapsed: "hidden" }, narrow)).toEqual({ mode: "rail", collapsed: "hidden" })
  })

  it("a sidebar collapsed on purpose stays as it was", () => {
    expect(shownSidebar({ mode: "hidden", collapsed: "hidden" }, narrow)).toEqual({ mode: "hidden", collapsed: "hidden" })
    expect(shownSidebar({ mode: "rail", collapsed: "rail" }, narrow)).toEqual({ mode: "rail", collapsed: "rail" })
  })

  it("expanded on purpose in the narrow window (⌘B, a button), it shows expanded", () => {
    expect(shownSidebar(DEFAULT_SIDEBAR, { narrow: true, expandedHere: true })).toEqual(DEFAULT_SIDEBAR)
  })

  it("a wide window shows the saved state", () => {
    expect(shownSidebar(DEFAULT_SIDEBAR, { narrow: false, expandedHere: false })).toEqual(DEFAULT_SIDEBAR)
  })

  it("⌘B in a narrow window acts on what's shown: from the automatic rail it expands", () => {
    expect(toggleSidebar(shownSidebar(DEFAULT_SIDEBAR, narrow))).toEqual(DEFAULT_SIDEBAR)
  })
})

describe("the sidebar's width", () => {
  it("starts at 240px, between 200 and 400, leaving the main panel at least 480px", () => {
    expect(readWidth(null, SIDEBAR_WIDTH)).toBe(240)
    expect(clampWidth(150, SIDEBAR_WIDTH, 1440)).toBe(200)
    expect(clampWidth(520, SIDEBAR_WIDTH, 1440)).toBe(400)
    expect(clampWidth(360, SIDEBAR_WIDTH, 800)).toBe(800 - 480)
  })
})
