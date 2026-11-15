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

const board: BoardState = { seq: 1, actors: {}, workspaces: {}, projects: {}, statuses: {}, labels: {}, tasks: {}, reviews: {}, documents: {} }

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
