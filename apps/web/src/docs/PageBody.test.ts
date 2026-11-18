import type { BoardState } from "@cello/client/sync/applyEvents"
import type { DocumentFile, Project, Status, Task } from "@cello/contract/entities"
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
const cel: Project = { id: "p1", workspaceId: "w1", name: "Cello", key: "CEL", color: "#000", description: "", repoPath: null, mergeAfterApproval: false, createdAt: 1, updatedAt: 1, archivedAt: null }
const review: Task = {
  id: "t8", projectId: "p1", number: 8, key: "CEL-8", title: "Review packets", description: "", statusId: "s2", priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me",
  createdBySessionId: null, updatedByActorId: null, updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null,
}
const board: BoardState = {
  seq: 1, actors: {}, workspaces: {}, projects: { p1: cel }, statuses: { s2: inProgress }, labels: {}, tasks: { t8: review }, sessions: {}, agents: {}, reviews: {}, asks: {}, documents: {}, wakes: {}, testOutcomes: {}, milestones: {},
}

/** The page body as the reader renders it, with the board above it (the key chips read it themselves). */
const render = (content: string, flash: { version: number; color: string; ids: string[] } | null = null, projectKeys?: string, files?: DocumentFile[]) =>
  renderToStaticMarkup(
    createElement(
      RegistryProvider,
      { initialValues: [[boardAtom, AsyncResult.success(board)]] },
      createElement(PageBody, { content, flash, onFlashEnd: () => {}, projectKeys, ...(files ? { files } : {}) }),
    ),
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
    // Its title is in the card hovering it shows (CEL-142), not a browser tooltip.
    expect(link).toContain('data-slot="hover-card-trigger"')
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

  // CEL-54: a page's video link led to a page that doesn't exist, with no way back.
  describe("links to files", () => {
    const files: DocumentFile[] = [
      { id: "01VIDEO", kind: "video", name: "a-palette-typing.mp4", mime: "video/mp4", hasPoster: false },
      { id: "01CLIP", kind: "video", name: "clip.webm", mime: "video/webm", hasPoster: true },
      { id: "01LOG", kind: "file", name: "vitest.log", mime: "text/plain; charset=utf-8", hasPoster: false },
    ]
    const page = (content: string) => render(content, null, undefined, files)

    it("plays a linked video inline, as a link or as an image, captioned by its text unless that's just the name", () => {
      const html = page("Typing in the palette:\n\n[a-palette-typing.mp4](/attachments/01VIDEO)\n\n![The clip](/attachments/01CLIP)")
      const videos = [...html.matchAll(/<video [^>]*>/g)].map((m) => m[0])
      expect(videos).toHaveLength(2)
      expect(videos[0]).toContain('src="/attachments/01VIDEO"')
      expect(videos[0]).toContain('aria-label="a-palette-typing.mp4"')
      expect(videos[0]).toMatch(/controls=""/)
      expect(videos[0]).toMatch(/playsInline=""|playsinline=""/)
      expect(videos[1]).toContain('aria-label="The clip"')
      expect(videos[1]).toContain('poster="/attachments/01CLIP/poster"')
      // Never a link the window could follow, and never a player inside a <p>.
      expect(html).not.toContain('href="/attachments/01VIDEO"')
      expect(html).not.toMatch(/<p>(?:(?!<\/p>).)*<video/s)
    })

    it("a video in a sentence takes the paragraph's place as a block", () => {
      const html = page("Watch [the demo](/attachments/01VIDEO) first.")
      expect(html).toMatch(/^<div class="page-prose" data-gallery=""><section data-section="intro"><div class="page-media">Watch <figure/)
      expect(html).toContain('aria-label="the demo"')
    })

    it("links to other files stay links that open elsewhere", () => {
      expect(page("[The log](/attachments/01LOG)")).toContain('<a href="/attachments/01LOG" target="_blank" rel="noreferrer">The log</a>')
    })

    it("a linked local file that never went up shows as a missing file, not a link", () => {
      const html = page("Still to record: [the demo](demo.mp4). ![Gone](shots/gone.png) [a route](/CEL/issues)")
      expect(html).not.toContain('href="demo.mp4"')
      expect(html).not.toContain('src="shots/gone.png"')
      expect(html.match(/data-missing-file=""/g)).toHaveLength(2)
      expect(html).toContain('title="demo.mp4 didn&#x27;t go up with the page"')
      expect(html).toMatch(/the demo<\/span><span [^>]*>missing file<\/span>/)
      expect(html).toMatch(/Gone<\/span><span [^>]*>missing file<\/span>/)
      expect(html).toContain('<a href="/CEL/issues">a route</a>')
    })
  })
})
