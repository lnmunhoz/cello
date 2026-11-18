import type { ComponentProps } from "react"
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown"
import { blockView } from "../../docs/codeBlock.ts"
import { Mermaid } from "../../docs/Mermaid.tsx"
import { DiffText } from "../../diff/DiffText.tsx"
import { useProjectKeys } from "../../lib/hooks.ts"
import { LiveTaskKey, markdownTaskKey } from "../../task/TaskKey.tsx"
import { ViewerLink } from "../../viewer/ViewerLink.tsx"
import { remarkPlugins } from "./remarkPlugins.ts"

/**
 * Rendered markdown with the app's type scale, GitHub-flavored as pages are (tables, task lists,
 * strikethrough; CEL-127). Raw HTML is never rendered. Links, bare web addresses
 * included, open in the viewer beside the board; task keys link to their task, with its live status;
 * ```mermaid blocks become diagrams (review packets explain a flow with one), and ```diff / ```patch
 * blocks the diff view (CEL-176; docs/codeBlock.ts says which blocks). Its diagrams are one
 * gallery in the image modal, unless `gallery` is false because what's around it is one (a packet).
 * `images="text"` (an agent's log, CEL-107): an image is never loaded, only named, as "Image: alt" and
 * its address in plain text, since text an agent saw could point the page at any address.
 * A table wider than the panel scrolls sideways inside its frame, never the page.
 */
export function Markdown({
  source,
  empty = "Nothing here yet.",
  gallery = true,
  images = "show",
}: { source: string; empty?: string; gallery?: boolean; images?: "show" | "text" }) {
  const projectKeys = useProjectKeys()
  if (source.trim() === "") return <p className="text-[13px] text-faint">{empty}</p>
  return (
    <div
      data-gallery={gallery ? "" : undefined}
      className="space-y-2 text-[13px] leading-relaxed text-ink [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-sunken [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_del]:text-muted [&_h1]:text-[17px] [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-sunken [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul.contains-task-list]:list-none [&_ul.contains-task-list]:pl-1 [&_.task-list-item_input]:mr-1.5 [&_.task-list-item_input]:align-[-1px] [&_.task-list-item_input]:accent-accent">
      <ReactMarkdown remarkPlugins={remarkPlugins(projectKeys)} components={images === "text" ? { ...components, img: ImageAsText } : components}>
        {source}
      </ReactMarkdown>
    </div>
  )
}

/**
 * A table in a frame that scrolls it sideways when it's wider than the panel. Columns take the width
 * their content needs (each line on one row, up to 22rem a cell, then it wraps), and fill the frame
 * when there's room to spare.
 */
function MarkdownTable({ children }: ComponentProps<"table"> & ExtraProps) {
  return (
    <div data-markdown-table="" className="max-w-full overflow-x-auto rounded-md border border-line">
      <table className="w-max min-w-full border-collapse text-[12px] leading-normal [&_td]:max-w-[22rem] [&_td]:border-t [&_td]:border-line [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top [&_th]:max-w-[22rem] [&_th]:bg-sunken [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-muted">
        {children}
      </table>
    </div>
  )
}

function MarkdownLink({ href, children, node }: ComponentProps<"a"> & ExtraProps) {
  const taskKey = markdownTaskKey(node)
  if (taskKey) return <LiveTaskKey taskKey={taskKey} />
  // An in-page anchor stays one.
  if (!href || href.startsWith("#")) return <a href={href}>{children}</a>
  // "[the PR](https://…)" is titled "the PR"; a bare address gets its short form from the viewer.
  const title = typeof children === "string" && children !== href ? children : undefined
  return (
    <ViewerLink href={href} title={title}>
      {children}
    </ViewerLink>
  )
}

/** An image named, never fetched: "Image: alt" and its address, as text. */
function ImageAsText({ alt, src }: ComponentProps<"img"> & ExtraProps) {
  return (
    <span data-markdown-image="" className="text-muted">
      Image: {alt || "untitled"} ({typeof src === "string" ? src : ""})
    </span>
  )
}

function MarkdownPre({ children }: ComponentProps<"pre"> & ExtraProps) {
  const view = blockView(children)
  if (view.kind === "mermaid") return <Mermaid source={view.source} />
  // Raw is the block as it was drawn before, so it keeps this container's look for <pre> (it scrolls sideways).
  if (view.kind === "diff") return <DiffText variant="inline" diff={view.diff} source={view.source} label="Diff" raw={<pre>{children}</pre>} />
  return <pre>{children}</pre>
}

const components: Components = { a: MarkdownLink, pre: MarkdownPre, table: MarkdownTable }
