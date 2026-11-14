import type { BoardState } from "@cello/client/sync/applyEvents"
import { openReviewOf } from "@cello/client/sync/reviews"
import type { Task } from "@cello/contract/entities"
import { CalendarIcon, ChevronRightIcon } from "lucide-react"
import { Chip } from "../components/ui/Chip.tsx"
import { PriorityIcon } from "../components/ui/PriorityIcon.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { formatDay, formatDue } from "../lib/format.ts"
import { EvidenceBadge } from "../review/EvidenceBadge.tsx"

/**
 * What a card shows: key and parent breadcrumb, status and title, then priority, due date and labels
 * (a row only when there is one of them), and the created date.
 */
export function CardBody({ task, board }: { task: Task; board: BoardState }) {
  const status = board.statuses[task.statusId]
  const parent = task.parentId ? board.tasks[task.parentId] : undefined
  const labels = task.labelIds.map((id) => board.labels[id]).filter((l) => l !== undefined && l.archivedAt === null)
  const chips = task.priority !== 0 || task.dueDate !== null || labels.length > 0 || openReviewOf(board, task.id) !== undefined
  return (
    <>
      <span className="flex min-w-0 items-center gap-1 text-xs text-muted">
        <span className="shrink-0 tabular-nums" data-card-key>
          {task.number > 0 ? task.key : "Creating…"}
        </span>
        {parent ? (
          <>
            <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-faint" />
            <span className="truncate" data-card-parent title={`Sub-task of ${parent.key} ${parent.title}`}>
              {parent.title}
            </span>
          </>
        ) : null}
      </span>
      <span className="flex items-start gap-2">
        {status ? (
          <span className="pt-0.5">
            <StatusIcon category={status.category} color={status.color} />
          </span>
        ) : null}
        <span className="text-[13px] leading-snug font-medium text-ink" data-card-title>
          {task.title}
        </span>
      </span>
      {chips ? (
        <span className="flex flex-wrap items-center gap-1.5" data-card-chips>
          {task.priority !== 0 ? (
            <span className="flex h-5.5 items-center rounded-md border border-line px-1">
              <PriorityIcon priority={task.priority} />
            </span>
          ) : null}
          {task.dueDate ? <Chip icon={<CalendarIcon aria-hidden className="size-3" />}>{formatDue(task.dueDate)}</Chip> : null}
          {labels.map((l) => (
            <Chip key={l!.id} color={l!.color}>
              {l!.name}
            </Chip>
          ))}
          <EvidenceBadge task={task} board={board} />
        </span>
      ) : null}
      <span className="text-xs text-faint">Created {formatDay(task.createdAt)}</span>
    </>
  )
}
