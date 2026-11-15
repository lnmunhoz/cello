import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { AGENT_BODY, AGENT_EYES, AGENT_SQUASH, AGENT_TIP, agentMarkBox, agentMarkSvg } from "./agentMark.ts"

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
})
