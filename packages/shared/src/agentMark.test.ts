import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  AGENT_BODY,
  AGENT_CENTER,
  AGENT_EYES,
  AGENT_FRAME,
  AGENT_HAPPY_EYES,
  AGENT_RADIUS,
  AGENT_SPINNER_BODY,
  AGENT_SQUASH,
  AGENT_TIP,
  agentFramePoint,
  agentMarkBox,
  agentMarkSvg,
} from "./agentMark.ts"

const art = (file: string) => readFileSync(new URL(`../../../art/icon/${file}`, import.meta.url), "utf8")

/** The numbers of a `viewBox="x y w h"` and `width="…"` in an SVG's markup. */
const frame = (svg: string) => {
  const [x, y, w, h] = svg.match(/viewBox="([^"]+)"/)![1]!.split(" ").map(Number)
  return { x: x!, y: y!, w: w!, h: h!, width: Number(svg.match(/ width="([^"]+)"/)![1]), height: Number(svg.match(/ height="([^"]+)"/)![1]) }
}

describe("the agent mark", () => {
  it("is the teardrop agent of the app icon and the favicon: the same body and the same two eyes", () => {
    for (const file of ["icon.svg", "favicon.svg"]) {
      const svg = art(file)
      expect(svg).toContain(`<path d="${AGENT_BODY}"`)
      for (const e of AGENT_EYES) expect(svg).toContain(`<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.w / 2}"/>`)
    }
  })

  it("starts its body at the tip, the sharp corner a cursor points with", () => {
    expect(AGENT_BODY.startsWith(`M${AGENT_TIP.x} ${AGENT_TIP.y} `)).toBe(true)
  })

  it("puts the tip where agentMarkBox says, at any size: the hotspot a cursor aligns with its target", () => {
    for (const width of [16, 24, 26, 48]) {
      const svg = agentMarkSvg({ width, body: "#8B5CF6", eyes: "white" })
      const f = frame(svg)
      const box = agentMarkBox(width)
      expect(f.width).toBe(width)
      expect(f.height).toBeCloseTo(box.height, 6)
      // The tip, from the mark's own coordinates to pixels inside the drawn box.
      const scale = f.width / f.w
      expect(f.h * scale).toBeCloseTo(f.height, 6)
      expect((AGENT_TIP.x - f.x) * scale).toBeCloseTo(box.tip.x, 6)
      expect((AGENT_TIP.y - f.y) * scale).toBeCloseTo(box.tip.y, 6)
      // The tip sits near the box's top-left corner, with room for the outline around it.
      expect(box.tip.x).toBeGreaterThan(0)
      expect(box.tip.x).toBeLessThan(width * 0.12)
    }
  })

  it("squashes along its axis, tip to centre, without moving: only rotations and scales, back where it started", () => {
    expect(AGENT_SQUASH[0]!.transform).toBe("rotate(46.1deg) scale(1, 1) rotate(-46.1deg)")
    for (const frame of AGENT_SQUASH) expect(frame.transform).not.toMatch(/translate/)
    expect(AGENT_SQUASH[0]!.transform).toBe(AGENT_SQUASH[AGENT_SQUASH.length - 1]!.transform)
  })

  it("draws the body in the given colour with the eyes over it, and an outline only when asked", () => {
    const plain = agentMarkSvg({ width: 24, body: "var(--agent)", eyes: "white" })
    expect(plain).toContain(`<path d="${AGENT_BODY}" fill="var(--agent)"`)
    expect(plain).toMatch(/<g data-agent-eyes[^>]* fill="white">/)
    expect(plain).not.toContain("stroke=")
    const outlined = agentMarkSvg({ width: 24, body: "#141416", eyes: "#FF7A2F", outline: "white" })
    expect(outlined).toContain('stroke="white"')
    expect(outlined).toContain('paint-order="stroke"')
  })

  describe("for the animated mark (CEL-69)", () => {
    /** The points a teardrop's path goes through: the tip (`M`), one side (`L`), the other side (the arc's end). */
    const points = (d: string) =>
      [...d.matchAll(/(?:[ML]|A[\d.]+ [\d.]+ 0 1 0 )(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
    const fromCenter = (p: { x: number; y: number }) => Math.hypot(p.x - AGENT_CENTER.x, p.y - AGENT_CENTER.y)

    it("names the circle the body is round around: the icon's eyes sit across its centre line", () => {
      expect(AGENT_CENTER).toEqual({ x: 575, y: 570 })
      expect(AGENT_RADIUS).toBe(270)
      for (const e of AGENT_EYES) expect(e.y + e.h / 2).toBe(AGENT_CENTER.y + 5)
    })

    it("has a spinner body: the same circle with a shorter tip on the same axis, so a spin reads as the tip going round", () => {
      const [tip, a, b] = points(AGENT_SPINNER_BODY) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
      const full = fromCenter(AGENT_TIP)
      expect(fromCenter(tip)).toBeGreaterThan(AGENT_RADIUS * 1.4)
      expect(fromCenter(tip)).toBeLessThan(full * 0.85)
      // On the axis from the centre to the icon's tip.
      const axis = Math.atan2(AGENT_TIP.y - AGENT_CENTER.y, AGENT_TIP.x - AGENT_CENTER.x)
      expect(Math.atan2(tip.y - AGENT_CENTER.y, tip.x - AGENT_CENTER.x)).toBeCloseTo(axis, 2)
      // Its two sides touch the circle.
      expect(fromCenter(a)).toBeCloseTo(AGENT_RADIUS, 0)
      expect(fromCenter(b)).toBeCloseTo(AGENT_RADIUS, 0)
      expect(AGENT_SPINNER_BODY).toContain(`A${AGENT_RADIUS} ${AGENT_RADIUS} 0 1 0`)
    })

    it("has happy eyes: an arch over each eye, as wide as the pill", () => {
      const arches = [...AGENT_HAPPY_EYES.matchAll(/M(-?[\d.]+) (-?[\d.]+) Q(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/g)].map((m) => m.slice(1).map(Number))
      expect(arches).toHaveLength(2)
      for (const [i, [x1, y1, cx, cy, x2, y2]] of arches.entries()) {
        const eye = AGENT_EYES[i]!
        expect(x1).toBeLessThanOrEqual(eye.x)
        expect(x2).toBeGreaterThanOrEqual(eye.x + eye.w)
        expect(cx).toBe(eye.x + eye.w / 2)
        expect(y1).toBe(y2)
        // An arch: the curve bends up, inside the pill's height.
        expect(cy!).toBeLessThan(y1!)
        expect(cy!).toBeGreaterThan(eye.y - eye.h)
      }
    })

    it("frames the body in a square that holds the tip and the whole circle, so marks line up with text at any size", () => {
      const { x, y, size } = AGENT_FRAME
      expect(x).toBeLessThanOrEqual(AGENT_TIP.x)
      expect(y).toBeLessThanOrEqual(AGENT_TIP.y)
      expect(x + size).toBeGreaterThanOrEqual(AGENT_CENTER.x + AGENT_RADIUS)
      expect(y + size).toBeGreaterThanOrEqual(AGENT_CENTER.y + AGENT_RADIUS)
      // Tight: less than a tenth of the frame is margin on either axis.
      expect(size - (AGENT_CENTER.x + AGENT_RADIUS - AGENT_TIP.x)).toBeLessThan(size * 0.1)
      expect(size - (AGENT_CENTER.y + AGENT_RADIUS - AGENT_TIP.y)).toBeLessThan(size * 0.1)
    })

    it("places a point of the icon inside the frame in percent, what CSS transform origins and translations use", () => {
      expect(agentFramePoint({ x: AGENT_FRAME.x, y: AGENT_FRAME.y })).toEqual({ x: 0, y: 0 })
      expect(agentFramePoint({ x: AGENT_FRAME.x + AGENT_FRAME.size, y: AGENT_FRAME.y + AGENT_FRAME.size })).toEqual({ x: 100, y: 100 })
      const c = agentFramePoint(AGENT_CENTER)
      expect(c.x).toBeCloseTo(((AGENT_CENTER.x - AGENT_FRAME.x) / AGENT_FRAME.size) * 100, 2)
    })
  })
})
