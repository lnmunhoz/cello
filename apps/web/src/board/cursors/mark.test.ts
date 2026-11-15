import { AGENT_SQUASH, AGENT_TIP, agentMarkBox } from "@cello/shared/agentMark"
import { describe, expect, it } from "vitest"
import { BLINK_DELAY, BLINK_MS, CURSOR_WIDTH, cursorMark, SQUASH } from "./mark.ts"
import { PACING } from "./pacing.ts"

/** Where the markup puts the mark's tip, relative to the cursor element's origin. */
const tipOf = (markup: string) => {
  const left = Number(markup.match(/left:(-?[\d.]+)px/)![1])
  const top = Number(markup.match(/top:(-?[\d.]+)px/)![1])
  const [vx, vy, vw] = markup.match(/viewBox="([^"]+)"/)![1]!.split(" ").map(Number)
  const width = Number(markup.match(/<svg[^>]* width="([^"]+)"/)![1])
  const scale = width / vw!
  return { x: left + (AGENT_TIP.x - vx!) * scale, y: top + (AGENT_TIP.y - vy!) * scale }
}

describe("the cursor's mark", () => {
  it("puts the teardrop's tip on the cursor's point: moving the cursor to a card's spot points the tip at it", () => {
    const markup = cursorMark()
    const tip = tipOf(markup)
    expect(tip.x).toBeCloseTo(0, 6)
    expect(tip.y).toBeCloseTo(0, 6)
    // The animator moves the element with translate(x, y): the tip lands on (x, y) itself.
    const at = { x: 412, y: 236 }
    expect(at.x + tip.x).toBeCloseTo(412, 6)
    expect(at.y + tip.y).toBeCloseTo(236, 6)
  })

  it("is a legible size, in the session's colour with light eyes and an outline", () => {
    expect(CURSOR_WIDTH).toBeGreaterThanOrEqual(22)
    expect(CURSOR_WIDTH).toBeLessThanOrEqual(28)
    const markup = cursorMark()
    expect(markup).toContain(`width="${CURSOR_WIDTH}"`)
    expect(markup).toContain('fill="var(--agent)"')
    expect(markup).toMatch(/data-agent-eyes[^>]* fill="white"/)
    expect(markup).toContain('stroke="white"')
  })

  it("squashes about the tip, so a click never moves the point it's making", () => {
    const { tip } = agentMarkBox(CURSOR_WIDTH)
    expect(cursorMark()).toContain(`transform-origin:${tip.x}px ${tip.y}px`)
    expect(SQUASH.map((k) => k.transform)).toEqual(AGENT_SQUASH.map((k) => k.transform))
  })

  it("blinks inside the linger: after a session's last step, and done before the cursor starts to fade", () => {
    expect(BLINK_DELAY).toBeGreaterThan(PACING.gap)
    expect(BLINK_DELAY + BLINK_MS).toBeLessThan(PACING.cursorLinger)
  })
})
