import { Children, isValidElement, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { remarkLinkify } from "../components/ui/remarkLinkify.ts"
import { LiveTaskKey, linkifyTasks, markdownTaskKey } from "../task/TaskKey.tsx"
import { Mermaid } from "./Mermaid.tsx"

/** Links that leave the page (other sites, stored files) open in a new tab. */
const opensElsewhere = (href: string | undefined) => href !== undefined && (/^(https?:)?\/\//i.test(href) || href.startsWith("/attachments/"))

/** The heading on the block's first line is the section's own: it gets the id the section list links to. */
const heading = (Tag: "h2" | "h3", id: string | undefined): Components["h2"] =>
  function Heading({ node, children }) {
    return <Tag id={node?.position?.start.line === 1 ? id : undefined}>{children}</Tag>
  }

/**
 * One block of a page's markdown (GitHub-flavored: tables, task lists, strikethrough), styled by the
 * `.page-prose` around it. Raw HTML is never rendered; ```mermaid blocks become diagrams; task keys of
 * `projectKeys` ("CEL THAI") link to their task, with its live status.
 */
export function Prose({ markdown, headingId, projectKeys }: { markdown: string; headingId?: string | undefined; projectKeys?: string | undefined }) {
  const components: Components = {
    h2: heading("h2", headingId),
    h3: heading("h3", headingId),
    pre({ children }) {
      const code = Children.toArray(children)[0]
      if (isValidElement<{ className?: string; children?: ReactNode }>(code) && code.props.className?.split(" ").includes("language-mermaid")) {
        return <Mermaid source={String(code.props.children ?? "").replace(/\n$/, "")} />
      }
      return (
        <div className="page-code">
          <pre>{children}</pre>
        </div>
      )
    },
    table({ children }) {
      return (
        <div className="page-table">
          <table>{children}</table>
        </div>
      )
    },
    a({ href, children, node }) {
      const taskKey = markdownTaskKey(node)
      if (taskKey) return <LiveTaskKey taskKey={taskKey} />
      return (
        <a href={href} {...(opensElsewhere(href) ? { target: "_blank", rel: "noreferrer" } : {})}>
          {children}
        </a>
      )
    },
    img({ src, alt, title }) {
      return (
        <>
          <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} title={title} loading="lazy" />
          {title ? <span className="page-caption">{title}</span> : null}
        </>
      )
    },
  }
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, [remarkLinkify, linkifyTasks(projectKeys)]]} components={components}>
      {markdown}
    </ReactMarkdown>
  )
}
