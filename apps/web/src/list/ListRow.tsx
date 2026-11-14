import type { BoardState } from "@cello/client/sync/applyEvents"
import { labelsOf, parentOf } from "@cello/client/sync/list"
import type { Project, Task } from "@cello/contract/entities"
import { Link } from "@tanstack/react-router"
import { CalendarIcon, ChevronRightIcon } from "lucide-react"
import type { KeyboardEvent } from "react"
import { Chip } from "../components/ui/Chip.tsx"
import { PriorityIcon } from "../components/ui/PriorityIcon.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { formatDay, formatDue } from "../lib/format.ts"

const MAX_LABELS = 3

const rowLook =
  "flex h-10 scroll-mt-11 scroll-mb-2 items-center gap-2.5 rounded-md px-2 text-[13px] outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset data-current:bg-selected"

export interface ListRowProps {
  readonly task: Task
  readonly board: BoardState
  readonly project: Project
  /** Width of the key column, in characters, so keys line up down the list. */
  readonly keyChars: number
  /** The task open in the panel. (The link also gets `aria-current="page"` from the router.) */
  readonly current: boolean
  /** The one row Tab lands on; the arrow keys move it. */
  readonly tabbable: boolean
  readonly onFocus: () => void
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

/** One task in the list, after Linear's: priority, key, status, title › parent, labels, due date, created date. */
export function ListRow({ task, board, project, keyChars, current, tabbable, onFocus, onKeyDown }: ListRowProps) {
  const body = <RowBody task={task} board={board} keyChars={keyChars} />
  // A task still being created has no number to open yet.
  if (task.number === 0) {
    return (
      <div data-task-key={task.key} aria-busy="true" className={`${rowLook} opacity-60`}>
        {body}
      </div>
    )
  }
  return (
    <Link
      to="/$projectKey/$number"
      params={{ projectKey: project.key, number: String(task.number) }}
      data-task-key={task.key}
      data-row-id={task.id}
      tabIndex={tabbable ? 0 : -1}
      data-current={current ? "" : undefined}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className={rowLook}
    >
      {body}
    </Link>
  )
}

function RowBody({ task, board, keyChars }: { task: Task; board: BoardState; keyChars: number }) {
  const status = board.statuses[task.statusId]
  const parent = parentOf(board, task)
  const labels = labelsOf(board, task)
  return (
    <>
      <span className="flex w-3.5 shrink-0 justify-center">{task.priority > 0 ? <PriorityIcon priority={task.priority} /> : null}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted" style={{ width: `${keyChars + 1}ch` }}>
        {task.key}
      </span>
      {status ? <StatusIcon category={status.category} color={status.color} /> : null}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate font-medium text-ink" data-row-title>
          {task.title}
        </span>
        {parent ? (
          <>
            <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-faint" />
            <span className="min-w-0 shrink-[3] truncate text-muted">
              <span className="sr-only">Sub-task of </span>
              {parent.title}
            </span>
          </>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {labels.slice(0, MAX_LABELS).map((l) => (
          <Chip key={l.id} color={l.color}>
            {l.name}
          </Chip>
        ))}
        {labels.length > MAX_LABELS ? <Chip>+{labels.length - MAX_LABELS}</Chip> : null}
        {task.dueDate ? (
          <Chip icon={<CalendarIcon aria-hidden className="size-3" />}>
            <span className="sr-only">Due </span>
            {formatDue(task.dueDate)}
          </Chip>
        ) : null}
      </span>
      <span className="min-w-12 shrink-0 text-right text-xs text-muted">
        <span className="sr-only">Created </span>
        {formatDay(task.createdAt)}
      </span>
    </>
  )
}
