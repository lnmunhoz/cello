import type { KeyedTask } from "@cello/client/sync/selectors"
import type { Status, Task } from "@cello/contract/entities"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PageBody } from "./PageBody.tsx"

const render = (content: string, flash: { version: number; color: string; ids: string[] } | null = null, tasks?: (key: string) => KeyedTask | undefined) =>
  renderToStaticMarkup(createElement(PageBody, { content, flash, onFlashEnd: () => {}, tasks }))

const inProgress: Status = {
  id: "s2", workspaceId: "w1", name: "In Progress", category: "started", position: "a1", color: "#f2c94c", hidden: false, createdAt: 1, updatedAt: 1,
}
const keyed = (key: string, title: string): KeyedTask => ({
  task: {
    id: key, projectId: "p1", number: Number(key.split("-")[1]), key, title, description: "", statusId: "s2", priority: 0, position: "a0",
    dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me",
    createdBySessionId: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null,
  } satisfies Task,
  status: inProgress,
})

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

  it("links the task keys in a table to their tasks, with each task's status; unknown keys and code stay as they are", () => {
    const content = [
      "## Progress",
      "",
      "| Task | What |",
      "| --- | --- |",
      "| CEL-8 | Review packets |",
      "| CEL-3 | `cello task claim CEL-8` |",
      "| NOPE-1 | Not on the board |",
    ].join("\n")
    const tasks = (key: string) => (key === "CEL-8" ? keyed("CEL-8", "Review packets") : undefined)
    const html = render(content, null, tasks)
    const link = html.match(/<a [^>]*data-task-key="CEL-8"[^>]*>.*?<\/a>/)?.[0] ?? ""
    expect(link).toContain('href="/CEL/8"')
    expect(link).toContain('title="CEL-8 · Review packets"')
    expect(link).toMatch(/>CEL-8<span [^>]*data-task-status=""[^>]*><svg [^>]*>.*<\/svg>In Progress<\/span><\/a>$/)
    expect(html.match(/data-task-key/g)).toHaveLength(1)
    expect(html).toContain("<td>CEL-3</td>")
    expect(html).toContain("<code>cello task claim CEL-8</code>")
    expect(html).toContain("<td>NOPE-1</td>")
  })
})
