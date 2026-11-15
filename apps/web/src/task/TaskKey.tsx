// Task keys in rendered text (pages, comments, descriptions, review packets): a link to the task with
// its live status beside it. remarkLinkify (markdown) and Linkified (plain text) find the keys; this
// renders them. A click opens the task in the main window wherever the key is shown (lib/desktop.ts).
import type { KeyedTask } from "@cello/client/sync/selectors"
import type { LinkifyOptions } from "@cello/shared/linkify"
import { parseTaskKey, taskPath } from "@cello/shared/taskKey"
import { useRouter } from "@tanstack/react-router"
import { createContext, use, type ComponentProps } from "react"
import type { ExtraProps } from "react-markdown"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { openTask } from "../lib/desktop.ts"
import { isPlainClick } from "../viewer/viewer.ts"

/** Finds a task by its key ("CEL-3"); undefined for a key with no task. */
export type FindTask = (key: string) => KeyedTask | undefined

/** How the markdown rendered below finds the tasks its keys link to. Without one, keys stay text. */
export const TaskFinderContext = createContext<FindTask | undefined>(undefined)

/** remarkLinkify's options: link the keys `find` knows. */
export const linkifyTasks = (find: FindTask | undefined): LinkifyOptions => ({ isTask: find ? (key) => find(key) !== undefined : undefined })

/** The task key on a link remarkLinkify made (react-markdown hands components the hast node). */
export const markdownTaskKey = (node: ExtraProps["node"]): string | undefined => {
  const key = node?.properties["dataTaskKey"]
  return typeof key === "string" ? key : undefined
}

/**
 * A link that opens task `taskKey` in the main window, from the board, the viewer's iframe or the
 * desktop app's panel. A real link, so ⌘-click, a middle click and "Copy link" still work.
 */
export function TaskLink({ taskKey, onClick, ...props }: { taskKey: string } & Omit<ComponentProps<"a">, "href">) {
  // Absent only when rendered outside the app (tests): there's nothing to navigate then.
  const router = useRouter({ warn: false })
  const task = parseTaskKey(taskKey)
  if (!task) return <span className={props.className}>{props.children}</span>
  return (
    <a
      {...props}
      href={taskPath(task.projectKey, task.number)}
      onClick={(e) => {
        onClick?.(e)
        if (!isPlainClick(e)) return
        const opened = openTask(taskKey, ({ projectKey, number }) => {
          void router?.navigate({ to: "/$projectKey/$number", params: { projectKey, number: String(number) } })
        })
        if (opened) e.preventDefault()
      }}
    />
  )
}

/** A task's key as a link, with its status (icon and name) beside it, current with the board. */
export function TaskKey({ found }: { found: KeyedTask }) {
  const { task, status } = found
  return (
    <TaskLink
      taskKey={task.key}
      data-task-key={task.key}
      title={`${task.key} · ${task.title}`}
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

/** A key remarkLinkify linked: the task with its live status, or just the key if the task is gone. */
export function MarkdownTaskKey({ taskKey }: { taskKey: string }) {
  const found = use(TaskFinderContext)?.(taskKey)
  return found ? <TaskKey found={found} /> : <>{taskKey}</>
}
