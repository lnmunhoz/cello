import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { describe, expect, it } from "vitest"
import { remarkLinkify, type MdNode } from "./remarkLinkify.ts"

const run = (tree: MdNode) => {
  remarkLinkify()(tree)
  return tree
}

describe("remarkLinkify", () => {
  it("turns bare addresses in text into links", () => {
    const tree = run({ type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "PR: https://a.dev/pr/1." }] }] })
    expect(tree.children?.[0]?.children).toEqual([
      { type: "text", value: "PR: " },
      { type: "link", url: "https://a.dev/pr/1", title: null, children: [{ type: "text", value: "https://a.dev/pr/1" }] },
      { type: "text", value: "." },
    ])
  })

  it("leaves links, inline code and code blocks as they are", () => {
    const link = { type: "link", url: "https://a.dev", children: [{ type: "text", value: "https://b.dev" }] }
    const code = { type: "inlineCode", value: "https://c.dev" }
    const block = { type: "code", value: "curl https://d.dev" }
    const tree = run({ type: "root", children: [{ type: "paragraph", children: [link, code] }, block] })
    expect(tree).toEqual({ type: "root", children: [{ type: "paragraph", children: [link, code] }, block] })
  })

  it("reaches text nested in emphasis and lists", () => {
    const tree = run({
      type: "root",
      children: [{ type: "list", children: [{ type: "listItem", children: [{ type: "emphasis", children: [{ type: "text", value: "https://e.dev" }] }] }] }],
    })
    expect(tree.children?.[0]?.children?.[0]?.children?.[0]?.children?.[0]).toMatchObject({ type: "link", url: "https://e.dev" })
  })
})

describe("remarkLinkify: task keys", () => {
  const isTask = (key: string) => key === "CEL-3" || key === "CEL-8"

  it("links known keys to their task, marked with the key", () => {
    const tree: MdNode = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "After CEL-3, FOO-1." }] }] }
    remarkLinkify({ isTask })(tree)
    expect(tree.children?.[0]?.children).toEqual([
      { type: "text", value: "After " },
      { type: "link", url: "/CEL/3", title: null, data: { hProperties: { dataTaskLink: "CEL-3" } }, children: [{ type: "text", value: "CEL-3" }] },
      { type: "text", value: ", FOO-1." },
    ])
  })

  it("in rendered markdown: table cells link, code spans, code blocks and existing links don't", () => {
    const source = [
      "| Task | Notes |",
      "| --- | --- |",
      "| CEL-3 | after `cello task claim CEL-8` |",
      "",
      "```sh",
      "cello task submit CEL-3",
      "```",
      "",
      "[the other one](https://a.dev/CEL-8) and **CEL-8**",
    ].join("\n")
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, [remarkLinkify, { isTask }]] }, source))
    expect(html).toContain('<td><a href="/CEL/3" data-task-link="CEL-3">CEL-3</a></td>')
    expect(html).toContain("<code>cello task claim CEL-8</code>")
    expect(html).toContain("cello task submit CEL-3\n</code></pre>")
    expect(html).toContain('<a href="https://a.dev/CEL-8">the other one</a>')
    expect(html).toContain('<strong><a href="/CEL/8" data-task-link="CEL-8">CEL-8</a></strong>')
    expect(html.match(/data-task-link/g)).toHaveLength(2)
  })
})
