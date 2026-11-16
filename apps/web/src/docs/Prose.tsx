import type { DocumentFile } from "@cello/contract/entities"
import { pageTarget } from "@cello/shared/document"
import { shortUrl } from "@cello/shared/linkify"
import { formatTaskKey } from "@cello/shared/taskKey"
import { Children, isValidElement, type ReactNode } from "react"
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown"
import { MissingFile } from "../components/ui/MissingFile.tsx"
import { remarkPlugins } from "../components/ui/remarkPlugins.ts"
import { openInPanel } from "../lib/desktop.ts"
import { Video } from "../review/Video.tsx"
import { LiveTaskKey, markdownTaskKey, TaskLink } from "../task/TaskKey.tsx"
import { openGallery, zoomable } from "../viewer/gallery.ts"
import { isPlainClick, taskOfHref } from "../viewer/viewer.ts"
import { Mermaid } from "./Mermaid.tsx"
import { mermaidSource } from "./mermaidSource.ts"

/** Links that leave the page (other sites, stored files) open in a new tab. */
const opensElsewhere = (href: string | undefined) => href !== undefined && (/^(https?:)?\/\//i.test(href) || href.startsWith("/attachments/"))

type Element = NonNullable<ExtraProps["node"]>
type ElementContent = Element["children"][number]

const hrefOf = (node: Element) => {
  const value = node.tagName === "a" ? node.properties["href"] : node.tagName === "img" ? node.properties["src"] : undefined
  return typeof value === "string" ? value : undefined
}

/** The plain text of an element: a link's words, for the video's caption. */
const textOf = (node: ElementContent): string =>
  node.type === "text" ? node.value : node.type === "element" ? node.children.map(textOf).join("") : ""

/** A video a link or an image points at, played inline: its link text or alt is the caption, unless that's just the name. */
const pageVideo = (file: DocumentFile, label: string) => (
  <Video video={{ id: file.id, name: file.name, caption: label.trim() === file.name ? "" : label.trim(), hasPoster: file.hasPoster }} />
)

/** The heading on the block's first line is the section's own: it gets the id the section list links to. */
const heading = (Tag: "h2" | "h3", id: string | undefined): Components["h2"] =>
  function Heading({ node, children }) {
    return <Tag id={node?.position?.start.line === 1 ? id : undefined}>{children}</Tag>
  }

/**
 * One block of a page's markdown (GitHub-flavored: tables, task lists, strikethrough), styled by the
 * `.page-prose` around it. Raw HTML is never rendered; ```mermaid blocks become diagrams; task keys of
 * `projectKeys` ("CEL THAI") link to their task, with its live status. A link or an image pointing at
 * one of the page's video `files` plays inline, and one to a local file that never went up shows as
 * a missing file instead of leading to a page that doesn't exist (CEL-54).
 */
export function Prose({
  markdown,
  headingId,
  projectKeys,
  files = [],
}: {
  markdown: string
  headingId?: string | undefined
  projectKeys?: string | undefined
  files?: ReadonlyArray<DocumentFile>
}) {
  const videoAt = (href: string | undefined) => {
    const target = pageTarget(href, files)
    return target.kind === "file" && target.file.kind === "video" ? target.file : undefined
  }
  const holdsVideo = (node: ElementContent): boolean =>
    node.type === "element" && (videoAt(hrefOf(node)) !== undefined || node.children.some(holdsVideo))
  const components: Components = {
    h2: heading("h2", headingId),
    h3: heading("h3", headingId),
    // A paragraph with a video in it is a block, since a player can't sit inside a <p>.
    p({ children, node }) {
      return node && holdsVideo(node) ? <div className="page-media">{children}</div> : <p>{children}</p>
    },
    pre({ children }) {
      const diagram = mermaidSource(children)
      if (diagram !== null) return <Mermaid source={diagram} />
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
      // A hand-written link to a task (`[the fix](/CEL/3)`) opens the task in the main window, as its key would.
      const linkedTask = taskOfHref(href, globalThis.location?.origin ?? "http://localhost")
      if (linkedTask) return <TaskLink taskKey={formatTaskKey(linkedTask.projectKey, linkedTask.number)}>{children}</TaskLink>
      const target = pageTarget(href, files)
      if (target.kind === "file" && target.file.kind === "video") return pageVideo(target.file, node ? textOf(node) : "")
      if (target.kind === "missing") return <MissingFile path={target.path}>{children}</MissingFile>
      // A plain click opens it where viewer.ts's `openRoute` says (CEL-60): one of the page's text files
      // or another Cello page in the side panel, an image in the image modal, another site in the
      // desktop app's built-in browser. ⌘-click still opens a tab.
      const file = target.kind === "file" ? target.file : undefined
      return (
        <a
          href={href}
          {...(opensElsewhere(href) ? { target: "_blank", rel: "noreferrer" } : {})}
          onClick={(e) => {
            if (!href || !isPlainClick(e)) return
            const label = node ? textOf(node).trim() : ""
            const kind = file ? (file.kind === "file" ? "text" : file.kind) : undefined
            if (openInPanel({ url: href, title: label || file?.name, kind, name: file?.name })) e.preventDefault()
          }}
        >
          {children}
        </a>
      )
    },
    img({ src, alt, title }) {
      const url = typeof src === "string" ? src : undefined
      const target = pageTarget(url, files)
      if (target.kind === "file" && target.file.kind === "video") return pageVideo(target.file, alt || title || "")
      if (target.kind === "missing") return <MissingFile path={target.path}>{alt || target.path}</MissingFile>
      // A click opens it in the image modal, with the page's other images and diagrams a ← or → away.
      return (
        <>
          <button
            type="button"
            className="page-image"
            aria-label={`Open ${alt || title || "the image"}`}
            {...(url ? zoomable({ url, title: alt || title || shortUrl(url) }) : {})}
            onClick={(e) => openGallery(e.currentTarget)}
          >
            <img data-page-image="" src={url} alt={alt ?? ""} title={title} loading="lazy" />
          </button>
          {title ? <span className="page-caption">{title}</span> : null}
        </>
      )
    },
  }
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins(projectKeys)} components={components}>
      {markdown}
    </ReactMarkdown>
  )
}
