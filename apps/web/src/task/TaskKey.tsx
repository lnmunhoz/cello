// Task keys in rendered text (pages, comments, descriptions, review packets): a link to the task with
// its live status beside it. remarkLinkify (markdown) and Linkified (plain text) find the keys of known
// projects; each key then reads its own task from the board, so a board change re-renders the keys it
// touches, never the markdown around them. Hovering or focusing a key shows a card about its task
// (CEL-142). A click opens the task in the main window wherever the key is shown (lib/desktop.ts):
// beside its own board, or in the side panel of the page you're on (CEL-141).
import type { KeyedTask } from "@cello/client/sync/selectors"
import type { LinkifyOptions } from "@cello/text/linkify"
import { parseTaskKey, taskPath } from "@cello/domain/taskKey"
import { useRouter } from "@tanstack/react-router"
import type { ComponentProps } from "react"
import type { ExtraProps } from "react-markdown"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../components/ui/HoverCard.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { openTask } from "../lib/desktop.ts"
import { useKeyedTask } from "../lib/hooks.ts"
import { isPlainClick } from "../viewer/viewer.ts"
import { openTaskHere } from "./openTaskHere.ts"
import { TaskPreviewOf } from "./TaskPreview.tsx"

/** remarkLinkify's options: link the keys of these projects ("CEL THAI", from `useProjectKeys`). */
export const linkifyTasks = (projectKeys: string | undefined): LinkifyOptions => {
  if (!projectKeys) return {}
  const known = new Set(projectKeys.split(" "))
  return { isTask: (key) => known.has(parseTaskKey(key)?.projectKey ?? "") }
}

/** The task key on a link remarkLinkify made (react-markdown hands components the hast node). */
export const markdownTaskKey = (node: ExtraProps["node"]): string | undefined => {
  const key = node?.properties["dataTaskLink"]
  return typeof key === "string" ? key : undefined
}

/**
 * A link that opens task `taskKey` in the main window, from the board, the viewer's iframe or the
 * desktop app's panel: beside its own project's board or list there, else in the side panel of the
 * page you're on (openTaskHere.ts). A real link to the task on its board, so ⌘-click, a middle click
 * and "Copy link" still work. Resting the pointer on it, or keyboard focus, shows a card about the task
 * (TaskPreview.tsx, CEL-142); `preview={false}` leaves it out where the task is already in view.
 */
export function TaskLink({ taskKey, onClick, preview = true, ...props }: { taskKey: string; preview?: boolean } & Omit<ComponentProps<"a">, "href">) {
  // Absent only when rendered outside the app (tests): there's nothing to navigate then.
  const router = useRouter({ warn: false })
  const task = parseTaskKey(taskKey)
  if (!task) return <span className={props.className}>{props.children}</span>
  const link = (
    <a
      {...props}
      href={taskPath(task.projectKey, task.number)}
      onClick={(e) => {
        onClick?.(e)
        if (!isPlainClick(e)) return
        const opened = openTask(taskKey, (found) => {
          if (router) openTaskHere(router, found)
        })
        if (opened) e.preventDefault()
      }}
    />
  )
  if (!preview) return link
  return (
    <HoverCard>
      <HoverCardTrigger render={link} />
      <HoverCardContent>
        <TaskPreviewOf taskKey={taskKey} />
      </HoverCardContent>
    </HoverCard>
  )
}

/** A task's key as a link, with its status (icon and name) beside it. */
export function TaskKey({ found }: { found: KeyedTask }) {
  const { task, status } = found
  return (
    <TaskLink
      taskKey={task.key}
      data-task-link={task.key}
      className="rounded-sm whitespace-nowrap text-accent underline decoration-1 underline-offset-2 outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {task.key}
      {status ? (
        // inline-flex: the link's underline stops at the key.
        <span data-task-status="" className="ml-1.5 inline-flex items-center gap-1 align-[-0.125em] text-[0.88em] text-muted">
          <StatusIcon category={status.category} color={status.color} size={12} />
          {status.name}
        </span>
      ) : null}
    </TaskLink>
  )
}

/** A key as the board has it now: the task's link with its status, or just the key when there's no such task. */
export function LiveTaskKey({ taskKey }: { taskKey: string }) {
  const found = useKeyedTask(taskKey)
  return found ? <TaskKey found={found} /> : <>{taskKey}</>
}
