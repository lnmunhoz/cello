import { describe, expect, it } from "vitest"
import { AGENT_COLORS, colorFromSeed } from "./color.ts"

describe("colorFromSeed", () => {
  it("gives the same palette color for the same seed", () => {
    const seed = "2fd0505c-417a-4167-acfe-2d66080fcae0"
    expect(colorFromSeed(seed)).toBe(colorFromSeed(seed))
    expect(AGENT_COLORS).toContain(colorFromSeed(seed))
  })

  it("spreads different seeds over the palette", () => {
    const colors = new Set(Array.from({ length: 40 }, (_, i) => colorFromSeed(`session-${i}`)))
    expect(colors.size).toBeGreaterThan(AGENT_COLORS.length / 2)
  })
})
