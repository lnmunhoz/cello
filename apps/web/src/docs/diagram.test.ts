import { describe, expect, it } from "vitest"
import { diagramSize, diagramTitle } from "./diagram.ts"

describe("diagramTitle", () => {
  it("names a diagram by its first label, on one line", () => {
    expect(diagramTitle("Start")).toBe("Diagram: Start")
    expect(diagramTitle("  ① A test drives Cello \n in Docker ")).toBe("Diagram: ① A test drives Cello in Docker")
  })

  it("cuts a long label short", () => {
    const title = diagramTitle("A label that goes on and on, much longer than a dialog title has room for in its header")
    expect(title.length).toBeLessThanOrEqual("Diagram: ".length + 60)
    expect(title.endsWith("…")).toBe(true)
  })

  it("is just Diagram without a label", () => {
    expect(diagramTitle(null)).toBe("Diagram")
    expect(diagramTitle("   ")).toBe("Diagram")
  })
})

describe("diagramSize", () => {
  it("is the size Mermaid drew it at, from its viewBox", () => {
    const svg = '<svg id="cello-diagram-1" width="100%" style="max-width: 345.5px;" viewBox="-8 -8 345.5 512.25" role="graphics-document document"><g/></svg>'
    expect(diagramSize(svg)).toEqual({ width: 345.5, height: 512.25 })
  })

  it("falls back to its width and height, and is null without either", () => {
    expect(diagramSize('<svg width="200" height="120"></svg>')).toEqual({ width: 200, height: 120 })
    expect(diagramSize('<svg width="100%"></svg>')).toBeNull()
    expect(diagramSize('<svg viewBox="0 0 0 0"></svg>')).toBeNull()
  })
})
