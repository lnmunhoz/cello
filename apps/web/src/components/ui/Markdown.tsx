import type { ComponentProps } from "react"
import ReactMarkdown, { type ExtraProps } from "react-markdown"
import { useProjectKeys } from "../../lib/hooks.ts"
import { LiveTaskKey, linkifyTasks, markdownTaskKey } from "../../task/TaskKey.tsx"
import { ViewerLink } from "../../viewer/ViewerLink.tsx"
import { remarkLinkify } from "./remarkLinkify.ts"

/**
 * Rendered markdown with the app's type scale. Raw HTML is never rendered. Links, bare web addresses
 * included, open in the viewer beside the board; task keys link to their task, with its live status.
 */
export function Markdown({ source, empty = "Nothing here yet." }: { source: string; empty?: string }) {
  const projectKeys = useProjectKeys()
  if (source.trim() === "") return <p className="text-[13px] text-faint">{empty}</p>
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-ink [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-sunken [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_h1]:text-[17px] [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-sunken [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[[remarkLinkify, linkifyTasks(projectKeys)]]} components={{ a: MarkdownLink }}>
        {source}
      </ReactMarkdown>
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
