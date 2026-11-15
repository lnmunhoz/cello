import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Project, Status, Task } from "@cello/contract/entities"
import { RegistryProvider } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { boardAtom } from "../lib/cello.ts"
import { PageBody } from "./PageBody.tsx"

// lib/cello.ts builds the socket's address from the page's location when it loads.
vi.hoisted(() => Object.assign(globalThis, { location: { protocol: "http:", host: "localhost:4747" } }))

const inProgress: Status = {
  id: "s2", workspaceId: "w1", name: "In Progress", category: "started", position: "a1", color: "#f2c94c", hidden: false, createdAt: 1, updatedAt: 1,
}
const cel: Project = { id: "p1", workspaceId: "w1", name: "Cello", key: "CEL", color: "#000", description: "", repoPath: null, createdAt: 1, updatedAt: 1, archivedAt: null }
const review: Task = {
  id: "t8", projectId: "p1", number: 8, key: "CEL-8", title: "Review packets", description: "", statusId: "s2", priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me",
  createdBySessionId: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null,
}
const board: BoardState = {
  seq: 1, actors: {}, workspaces: {}, projects: { p1: cel }, statuses: { s2: inProgress }, labels: {}, tasks: { t8: review }, reviews: {}, documents: {},
}

/** The page body as the reader renders it, with the board above it (the key chips read it themselves). */
const render = (content: string, flash: { version: number; color: string; ids: string[] } | null = null, projectKeys?: string) =>
  renderToStaticMarkup(
    createElement(RegistryProvider, { initialValues: [[boardAtom, AsyncResult.success(board)]] }, createElement(PageBody, { content, flash, onFlashEnd: () => {}, projectKeys })),
  )

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

  it("shows images with their title as a caption, each a button that opens it in the image modal, and never raw HTML", () => {
    const html = render(REPORT)
    expect(html).toContain(
      '<button type="button" class="page-image" aria-label="Open The board" data-zoomable="image" data-url="/attachments/01ABC" data-title="The board"><img data-page-image="" src="/attachments/01ABC" alt="The board" title="The board after the fix" loading="lazy"/></button>',
    )
    expect(html).toContain('<span class="page-caption">The board after the fix</span>')
    expect(html).not.toContain("<script")
  })

  it("marks the sections a new version changed, in the publisher's color", () => {
    const html = render(REPORT, { version: 2, color: "#7C3AED", ids: ["findings"] })
    expect(html).toMatch(/<section data-section="findings" data-changed="">\s*<span class="page-flash" style="--flash:#7C3AED" aria-hidden="true"><\/span>/)
    expect(html).not.toMatch(/data-section="flow" data-changed/)
  })

  it("links the task keys in a table to their tasks, with each task's status from the board; unknown keys and code stay as they are", () => {
    const content = [
      "## Progress",
      "",
      "| Task | What |",
      "| --- | --- |",
      "| CEL-8 | Review packets |",
      "| CEL-999 | `cello task claim CEL-8` |",
      "| NOPE-1 | Not a project |",
    ].join("\n")
    const html = render(content, null, "CEL")
    const link = html.match(/<a [^>]*data-task-link="CEL-8"[^>]*>.*?<\/a>/)?.[0] ?? ""
    expect(link).toContain('href="/CEL/8"')
    expect(link).toContain('title="CEL-8 · Review packets"')
    expect(link).toMatch(/>CEL-8<span [^>]*data-task-status=""[^>]*><svg [^>]*>.*<\/svg>In Progress<\/span><\/a>$/)
    expect(html.match(/data-task-link/g)).toHaveLength(1)
    // A known project but no such task, a key in code, an unknown project: text.
    expect(html).toContain("<td>CEL-999</td>")
    expect(html).toContain("<code>cello task claim CEL-8</code>")
    expect(html).toContain("<td>NOPE-1</td>")
  })

  it("without the project keys, keys stay text", () => {
    expect(render("CEL-8 shipped.")).toContain("<p>CEL-8 shipped.</p>")
  })
})
