import { linkify } from "@cello/shared/linkify"
import type { ReactNode } from "react"
import { openInPanel } from "../lib/desktop.ts"
import { useTaskFinder } from "../lib/hooks.ts"
import { linkifyTasks, TaskKey } from "../task/TaskKey.tsx"
import { isPlainClick } from "./viewer.ts"

/**
 * A link that opens beside the board (the viewer, or the desktop app's panel) on a plain click.
 * ⌘-click, a middle click and "Copy link" still work, since it's a real link with a real href.
 */
export function ViewerLink({ href, title, children }: { href: string; title?: string | undefined; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline underline-offset-2 outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
      onClick={(e) => {
        if (isPlainClick(e) && openInPanel(href, title)) e.preventDefault()
      }}
    >
      {children}
    </a>
  )
}

/** Plain text with its web addresses as viewer links, and its task keys as links to the task with its live status. */
export function Linkified({ text }: { text: string }) {
  const tasks = useTaskFinder()
  return (
    <>
      {linkify(text, linkifyTasks(tasks)).map((part, i) => {
        if (part.type === "text") return part.text
        if (part.type === "link") {
          return (
            <ViewerLink key={i} href={part.url}>
              {part.text}
            </ViewerLink>
          )
        }
        const found = tasks?.(part.key)
        return found ? <TaskKey key={i} found={found} /> : part.text
      })}
    </>
  )
}
