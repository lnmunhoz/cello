import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PageBody } from "./PageBody.tsx"

const render = (content: string, flash: { version: number; color: string; ids: string[] } | null = null) =>
  renderToStaticMarkup(createElement(PageBody, { content, flash, onFlashEnd: () => {} }))

const REPORT = [
  "We checked **every** invoice. See [the PR][pr].",
  "",
  "## Findings",
  "",
  "| Invoice | Amount |",
  "| --- | ---: |",
  "| INV-1 | 10 |",
  "",
  "```ts",
  "const total = 1 < 2",
  "```",
  "",
  "### Flow",
  "",
  "```mermaid",
  "flowchart TD",
  "  A[Publish] --> B[Read]",
  "```",
  "",
  "![The board](/attachments/01ABC \"The board after the fix\")",
  "",
  "<script>alert(1)</script>",
  "",
  "[pr]: https://github.com/lnmunhoz/cello/pull/13",
].join("\n")

describe("PageBody", () => {
  it("renders one section per heading, the heading carrying the TOC's id", () => {
    const html = render(REPORT)
    expect([...html.matchAll(/<section[^>]*data-section="([^"]+)"/g)].map((m) => m[1])).toEqual(["intro", "findings", "flow"])
    expect(html).toContain('<h2 id="findings">Findings</h2>')
    expect(html).toContain('<h3 id="flow">Flow</h3>')
  })

  it("frames tables, renders code blocks and inline code, and resolves reference links in every section", () => {
    const html = render(REPORT)
    expect(html).toMatch(/<div class="page-table"><table><thead><tr><th>Invoice<\/th><th style="text-align:right">Amount<\/th><\/tr><\/thead>/)
    expect(html).toContain('<div class="page-code"><pre><code class="language-ts">const total = 1 &lt; 2\n</code></pre></div>')
    expect(html).toContain("<strong>every</strong>")
    expect(html).toContain('<a href="https://github.com/lnmunhoz/cello/pull/13" target="_blank" rel="noreferrer">the PR</a>')
  })

  it("renders a mermaid block as a diagram, not as code", () => {
    const html = render(REPORT)
    expect(html).toMatch(/<figure class="page-diagram" data-mermaid="" aria-busy="true"/)
    expect(html).not.toContain("language-mermaid")
  })

  it("shows images with their title as a caption, and never raw HTML", () => {
    const html = render(REPORT)
    expect(html).toContain('<img src="/attachments/01ABC" alt="The board" title="The board after the fix" loading="lazy"/>')
    expect(html).toContain('<span class="page-caption">The board after the fix</span>')
    expect(html).not.toContain("<script")
  })

  it("marks the sections a new version changed, in the publisher's color", () => {
    const html = render(REPORT, { version: 2, color: "#7C3AED", ids: ["findings"] })
    expect(html).toMatch(/<section data-section="findings" data-changed="">\s*<span class="page-flash" style="--flash:#7C3AED" aria-hidden="true"><\/span>/)
    expect(html).not.toMatch(/data-section="flow" data-changed/)
  })
})
