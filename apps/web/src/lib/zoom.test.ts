import { describe, expect, it } from "vitest"
import {
  clampView,
  FIT_MARGIN,
  fitScale,
  fitView,
  isZoomed,
  MAX_SCALE,
  panBy,
  pinch,
  refit,
  toggleZoom,
  wheelFactor,
  zoomAt,
  zoomBy,
  type Frame,
} from "./zoom.ts"

/** A 1440×900 screenshot on a 1000×700 stage: fitted, it's smaller than 100%. */
const frame: Frame = { image: { width: 1440, height: 900 }, stage: { width: 1000, height: 700 } }
const fit = (1000 - 2 * FIT_MARGIN) / 1440

describe("fit: the whole image on the stage, centred", () => {
  it("scales to the tighter side, leaving the margin, and never past 100%", () => {
    expect(fitScale(frame)).toBeCloseTo(fit)
    // Tall: the height decides.
    expect(fitScale({ image: { width: 400, height: 2000 }, stage: frame.stage })).toBeCloseTo((700 - 2 * FIT_MARGIN) / 2000)
    // Smaller than the stage: shown at its own size.
    expect(fitScale({ image: { width: 300, height: 200 }, stage: frame.stage })).toBe(1)
  })

  it("is centred on the stage", () => {
    const view = fitView(frame)
    expect(view.scale).toBeCloseTo(fit)
    expect(view.x).toBeCloseTo((1000 - 1440 * fit) / 2)
    expect(view.y).toBeCloseTo((700 - 900 * fit) / 2)
    expect(isZoomed(view, frame)).toBe(false)
  })

  it("an empty stage or an image without a size (not loaded yet) still gives a usable scale", () => {
    expect(fitScale({ image: { width: 0, height: 0 }, stage: frame.stage })).toBe(1)
    expect(fitScale({ image: frame.image, stage: { width: 0, height: 0 } })).toBeGreaterThan(0)
  })
})

describe("clamping", () => {
  it("never zooms out past fit, nor in past the maximum", () => {
    expect(clampView({ scale: 0.01, x: 0, y: 0 }, frame).scale).toBeCloseTo(fit)
    expect(clampView({ scale: 100, x: 0, y: 0 }, frame).scale).toBe(MAX_SCALE)
  })

  it("an image larger than the stage can't be dragged past its edges", () => {
    // At 100% the image is 1440×900 on a 1000×700 stage: x between -440 and 0, y between -200 and 0.
    expect(clampView({ scale: 1, x: 50, y: 80 }, frame)).toEqual({ scale: 1, x: 0, y: 0 })
    expect(clampView({ scale: 1, x: -900, y: -900 }, frame)).toEqual({ scale: 1, x: -440, y: -200 })
    expect(clampView({ scale: 1, x: -100, y: -50 }, frame)).toEqual({ scale: 1, x: -100, y: -50 })
  })

  it("a side smaller than the stage stays centred", () => {
    // A wide strip: at 100% wider than the stage but not as tall.
    const strip: Frame = { image: { width: 2000, height: 300 }, stage: frame.stage }
    const view = clampView({ scale: 1, x: -500, y: -40 }, strip)
    expect(view.x).toBe(-500)
    expect(view.y).toBe((700 - 300) / 2)
  })
})

describe("zooming around a point", () => {
  it("keeps the image point under the cursor where it is", () => {
    const start = fitView(frame)
    const cursor = { x: 700, y: 300 }
    // The image pixel under the cursor before…
    const px = (cursor.x - start.x) / start.scale
    const py = (cursor.y - start.y) / start.scale
    const zoomed = zoomAt(start, 1, cursor, frame)
    expect(zoomed.scale).toBe(1)
    // …is still under it after.
    expect(zoomed.x + px * zoomed.scale).toBeCloseTo(cursor.x)
    expect(zoomed.y + py * zoomed.scale).toBeCloseTo(cursor.y)
    expect(isZoomed(zoomed, frame)).toBe(true)
  })

  it("is clamped, so zooming at a corner doesn't pull the image off the stage", () => {
    const zoomed = zoomAt(fitView(frame), 1, { x: 0, y: 0 }, frame)
    expect(zoomed).toEqual({ scale: 1, x: 0, y: 0 })
  })

  it("zoomBy multiplies the scale, within the limits", () => {
    const start = fitView(frame)
    expect(zoomBy(start, 2, { x: 500, y: 350 }, frame).scale).toBeCloseTo(fit * 2)
    expect(zoomBy(start, 0.5, { x: 500, y: 350 }, frame)).toEqual(start)
    expect(zoomBy({ scale: 7, x: 0, y: 0 }, 4, { x: 0, y: 0 }, frame).scale).toBe(MAX_SCALE)
  })

  it("a pinch scales by how far the fingers spread, around where they are, and follows them as they move", () => {
    const start = zoomAt(fitView(frame), 1, { x: 500, y: 350 }, frame)
    const spread = pinch(start, [{ x: 400, y: 350 }, { x: 600, y: 350 }], [{ x: 300, y: 350 }, { x: 700, y: 350 }], frame)
    expect(spread.scale).toBeCloseTo(2)
    // The point between the fingers stays put.
    expect(spread.x + ((500 - start.x) / start.scale) * spread.scale).toBeCloseTo(500)
    const moved = pinch(spread, [{ x: 300, y: 350 }, { x: 700, y: 350 }], [{ x: 280, y: 340 }, { x: 680, y: 340 }], frame)
    expect(moved.scale).toBeCloseTo(2)
    expect(moved.x).toBeCloseTo(spread.x - 20)
    expect(moved.y).toBeCloseTo(spread.y - 10)
  })
})

describe("double-click: to 100% and back", () => {
  it("from fit, to 100% around the point clicked; from any zoom, back to fit", () => {
    const start = fitView(frame)
    const full = toggleZoom(start, { x: 600, y: 400 }, frame)
    expect(full.scale).toBe(1)
    expect(toggleZoom(full, { x: 600, y: 400 }, frame)).toEqual(start)
    expect(toggleZoom({ scale: 3, x: -1000, y: -500 }, { x: 0, y: 0 }, frame)).toEqual(start)
  })

  it("an image already shown at 100% to fit has nowhere to go", () => {
    const small: Frame = { image: { width: 300, height: 200 }, stage: frame.stage }
    expect(toggleZoom(fitView(small), { x: 500, y: 350 }, small)).toEqual(fitView(small))
  })
})

describe("panning", () => {
  it("moves a zoomed image by the drag, within its edges", () => {
    const view = { scale: 1, x: -200, y: -100 }
    expect(panBy(view, { x: 50, y: -30 }, frame)).toEqual({ scale: 1, x: -150, y: -130 })
    expect(panBy(view, { x: 9999, y: 9999 }, frame)).toEqual({ scale: 1, x: 0, y: 0 })
  })

  it("does nothing to a fitted image", () => {
    const view = fitView(frame)
    expect(panBy(view, { x: 80, y: 80 }, frame)).toEqual(view)
  })
})

describe("the wheel", () => {
  it("up zooms in, down zooms out; a mouse notch is a step, not a jump", () => {
    const notchUp = wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false })
    expect(notchUp).toBeGreaterThan(1.1)
    expect(notchUp).toBeLessThan(1.4)
    expect(wheelFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(1 / notchUp)
    expect(wheelFactor({ deltaY: 0, deltaMode: 0, ctrlKey: false })).toBe(1)
  })

  it("a trackpad pinch (the browser sends a wheel with Ctrl held and small deltas) zooms about as fast as the fingers move", () => {
    const pinchOut = wheelFactor({ deltaY: -10, deltaMode: 0, ctrlKey: true })
    expect(pinchOut).toBeGreaterThan(1.05)
    expect(pinchOut).toBeLessThan(1.2)
  })

  it("counts line and page deltas in pixels, and caps one event", () => {
    expect(wheelFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false })).toBeCloseTo(wheelFactor({ deltaY: -48, deltaMode: 0, ctrlKey: false }))
    expect(wheelFactor({ deltaY: -1, deltaMode: 2, ctrlKey: false })).toBe(wheelFactor({ deltaY: -100000, deltaMode: 0, ctrlKey: false }))
    expect(wheelFactor({ deltaY: -100000, deltaMode: 0, ctrlKey: false })).toBeLessThan(2)
  })
})

describe("when the stage changes size (the window resizes)", () => {
  it("a fitted image is fitted again", () => {
    const to: Frame = { image: frame.image, stage: { width: 600, height: 500 } }
    expect(refit(fitView(frame), frame, to)).toEqual(fitView(to))
  })

  it("a zoomed image keeps its scale and the point at the centre, within its edges", () => {
    const zoomed = { scale: 1, x: -200, y: -100 }
    const to: Frame = { image: frame.image, stage: { width: 1200, height: 700 } }
    const next = refit(zoomed, frame, to)
    expect(next.scale).toBe(1)
    expect(next.x).toBe(-100)
    expect(next.y).toBe(-100)
  })
})
