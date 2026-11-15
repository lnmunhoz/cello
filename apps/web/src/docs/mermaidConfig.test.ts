import { describe, expect, it } from "vitest"
import { backgroundOf, mermaidConfig } from "./mermaidConfig.ts"

describe("mermaidConfig", () => {
  it("always renders strict: no scripts, sanitized labels", () => {
    expect(mermaidConfig({ dark: false, background: "#ffffff" }).securityLevel).toBe("strict")
    expect(mermaidConfig({ dark: true, background: "#1c1c1f" }).securityLevel).toBe("strict")
  })

  it("follows the app's theme", () => {
    expect(mermaidConfig({ dark: false, background: "#ffffff" }).theme).toBe("default")
    expect(mermaidConfig({ dark: true, background: "#1c1c1f" }).theme).toBe("dark")
  })

  it("wraps flowchart labels at a readable width, not Mermaid's 120 px", () => {
    const { flowchart } = mermaidConfig({ dark: false, background: "#ffffff" })
    expect(flowchart.wrappingWidth).toBeGreaterThanOrEqual(260)
    expect(flowchart.nodeSpacing).toBeGreaterThan(0)
    expect(flowchart.rankSpacing).toBeGreaterThan(0)
  })

  it("gives edge labels the color behind the diagram, so they sit on it without a box", () => {
    expect(mermaidConfig({ dark: true, background: "rgb(28, 28, 31)" }).themeVariables.edgeLabelBackground).toBe("rgb(28, 28, 31)")
  })

  it("lays nodes out in the order they're written, so the start stays on top even with loops back to it", () => {
    expect(mermaidConfig({ dark: false, background: "#ffffff" }).elk.cycleBreakingStrategy).toBe("MODEL_ORDER")
  })
})

describe("backgroundOf", () => {
  it("is the first color, from the element outward, that isn't transparent", () => {
    expect(backgroundOf(["rgba(0, 0, 0, 0)", "transparent", "rgb(28, 28, 31)", "rgb(255, 255, 255)"])).toBe("rgb(28, 28, 31)")
    expect(backgroundOf(["rgb(21, 21, 23)"])).toBe("rgb(21, 21, 23)")
  })

  it("counts a half-transparent color as the background", () => {
    expect(backgroundOf(["rgba(28, 28, 31, 0.5)"])).toBe("rgba(28, 28, 31, 0.5)")
  })

  it("falls back to the fallback when nothing has a background", () => {
    expect(backgroundOf(["rgba(0, 0, 0, 0)", "transparent"], "#ffffff")).toBe("#ffffff")
  })
})
