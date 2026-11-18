// A remark plugin: bare web addresses in markdown text become links (react-markdown only links
// `<https://…>` and `[text](url)` on its own), and so do the task keys `isTask` accepts, as links to the
// task marked `data-task-link` (LiveTaskKey renders them). Code and existing links are left alone.
import { linkify, type LinkifyOptions } from "@cello/text/linkify"
import { taskPath } from "@cello/domain/taskKey"

/** The bits of an mdast node this plugin reads and writes. */
export interface MdNode {
  type: string
  value?: string
  url?: string
  title?: string | null
  data?: { hProperties?: Record<string, string> }
  children?: MdNode[]
}

const LEAVE = new Set(["link", "linkReference", "inlineCode", "code", "definition", "html"])

const walk = (node: MdNode, options: LinkifyOptions) => {
  if (!node.children || LEAVE.has(node.type)) return
  node.children = node.children.flatMap((child): MdNode[] => {
    if (child.type !== "text" || child.value === undefined) {
      walk(child, options)
      return [child]
    }
    const parts = linkify(child.value, options)
    if (!parts.some((part) => part.type !== "text")) return [child]
    return parts.map((part): MdNode => {
      switch (part.type) {
        case "text":
          return { type: "text", value: part.text }
        case "link":
          return { type: "link", url: part.url, title: null, children: [{ type: "text", value: part.text }] }
        case "task":
          return {
            type: "link",
            url: taskPath(part.projectKey, part.number),
            title: null,
            data: { hProperties: { dataTaskLink: part.key } },
            children: [{ type: "text", value: part.text }],
          }
      }
    })
  })
}

/** `isTask`: whether to link a key; without it, keys stay text. */
export const remarkLinkify =
  (options: LinkifyOptions = {}) =>
  (tree: MdNode) =>
    walk(tree, options)
