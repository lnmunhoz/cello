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
