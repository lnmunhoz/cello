import { createElement } from "react"
import { describe, expect, it } from "vitest"
import { mermaidSource } from "./mermaidSource.ts"

describe("mermaidSource", () => {
  it("finds a ```mermaid block's source inside a <pre>", () => {
    const code = createElement("code", { className: "language-mermaid" }, "flowchart TD\n  A --> B\n")
    expect(mermaidSource(code)).toBe("flowchart TD\n  A --> B")
  })

  it("leaves other code blocks alone", () => {
    expect(mermaidSource(createElement("code", { className: "language-ts" }, "const a = 1"))).toBeNull()
    expect(mermaidSource("plain text")).toBeNull()
  })
})
