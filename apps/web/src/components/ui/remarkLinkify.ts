// A remark plugin: bare web addresses in markdown text become links (react-markdown only links
// `<https://…>` and `[text](url)` on its own). Code and existing links are left alone.
import { linkify } from "@cello/shared/linkify"

/** The bits of an mdast node this plugin reads and writes. */
export interface MdNode {
  type: string
  value?: string
  url?: string
  title?: string | null
  children?: MdNode[]
}

const LEAVE = new Set(["link", "linkReference", "inlineCode", "code", "definition", "html"])

const walk = (node: MdNode) => {
  if (!node.children || LEAVE.has(node.type)) return
  node.children = node.children.flatMap((child): MdNode[] => {
    if (child.type !== "text" || child.value === undefined) {
      walk(child)
      return [child]
    }
    const parts = linkify(child.value)
    if (!parts.some((part) => part.type === "link")) return [child]
    return parts.map((part) =>
      part.type === "text"
        ? { type: "text", value: part.text }
        : { type: "link", url: part.url, title: null, children: [{ type: "text", value: part.text }] },
    )
  })
}

export const remarkLinkify = () => (tree: MdNode) => walk(tree)
