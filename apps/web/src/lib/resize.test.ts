import { describe, expect, it } from "vitest"
import { clampWidth, dragWidth, keyWidth, readWidth, widthLimits, type WidthRule } from "./resize.ts"

/** Like the viewer: no maximum of its own, it leaves 360px for the page beside it. */
const VIEWER: WidthRule = { initial: 560, min: 320, minRest: 360, step: 32 }
/** Like the sidebar: a maximum of its own too. */
const SIDEBAR: WidthRule = { initial: 240, min: 200, max: 400, minRest: 480, step: 16 }

describe("readWidth: the width remembered on this device", () => {
  it("the saved width, or the initial one when nothing (or nonsense) is saved", () => {
    expect(readWidth(null, VIEWER)).toBe(560)
    expect(readWidth("abc", VIEWER)).toBe(560)
    expect(readWidth("-5", VIEWER)).toBe(560)
    expect(readWidth("720", VIEWER)).toBe(720)
    expect(readWidth("250.6", SIDEBAR)).toBe(251)
  })

  it("within the panel's own minimum and maximum, whatever was saved", () => {
    expect(readWidth("90", SIDEBAR)).toBe(200)
    expect(readWidth("9000", SIDEBAR)).toBe(400)
  })
})

describe("clampWidth", () => {
  it("stays between the minimum and what leaves the rest of the container usable", () => {
    expect(clampWidth(700, VIEWER, 1200)).toBe(700)
    expect(clampWidth(100, VIEWER, 1200)).toBe(320)
    expect(clampWidth(1100, VIEWER, 1200)).toBe(1200 - 360)
  })

  it("never past its own maximum", () => {
    expect(clampWidth(380, SIDEBAR, 1440)).toBe(380)
    expect(clampWidth(600, SIDEBAR, 1440)).toBe(400)
  })

  it("the minimum wins in a container too narrow for both", () => {
    expect(clampWidth(500, VIEWER, 500)).toBe(320)
    expect(clampWidth(300, SIDEBAR, 390)).toBe(200)
  })
})

describe("dragWidth: the width while one edge is dragged from start.x to x", () => {
  it("a panel's left edge (the viewer): dragging left makes it wider", () => {
    expect(dragWidth({ width: 560, x: 800 }, 600, "left", VIEWER, 1200)).toBe(760)
    expect(dragWidth({ width: 560, x: 800 }, 900, "left", VIEWER, 1200)).toBe(460)
    expect(dragWidth({ width: 560, x: 800 }, 0, "left", VIEWER, 1200)).toBe(1200 - 360)
  })

  it("a panel's right edge (the sidebar): dragging right makes it wider, up to its maximum", () => {
    expect(dragWidth({ width: 240, x: 240 }, 320, "right", SIDEBAR, 1440)).toBe(320)
    expect(dragWidth({ width: 240, x: 240 }, 100, "right", SIDEBAR, 1440)).toBe(200)
    expect(dragWidth({ width: 240, x: 240 }, 900, "right", SIDEBAR, 1440)).toBe(400)
  })
})

describe("keyWidth: ← and → move the edge one step", () => {
  it("moving a left edge left widens the panel; moving a right edge right does", () => {
    expect(keyWidth("ArrowLeft", 560, "left", VIEWER, 1200)).toBe(592)
    expect(keyWidth("ArrowRight", 560, "left", VIEWER, 1200)).toBe(528)
    expect(keyWidth("ArrowRight", 240, "right", SIDEBAR, 1440)).toBe(256)
    expect(keyWidth("ArrowLeft", 240, "right", SIDEBAR, 1440)).toBe(224)
  })

  it("clamped like a drag, and other keys aren't its business", () => {
    expect(keyWidth("ArrowLeft", 200, "right", SIDEBAR, 1440)).toBe(200)
    expect(keyWidth("ArrowUp", 240, "right", SIDEBAR, 1440)).toBeNull()
    expect(keyWidth("Enter", 560, "left", VIEWER, 1200)).toBeNull()
  })
})

describe("widthLimits: the same limits in CSS, so a narrower window keeps them before anyone drags", () => {
  it("the minimum (or the whole container when it's smaller), up to the maximum and the room left for the rest", () => {
    expect(widthLimits(SIDEBAR)).toEqual({ minWidth: "min(200px, 100%)", maxWidth: "max(min(200px, 100%), min(400px, calc(100% - 480px)))" })
    expect(widthLimits(VIEWER)).toEqual({ minWidth: "min(320px, 100%)", maxWidth: "max(min(320px, 100%), calc(100% - 360px))" })
  })
})
