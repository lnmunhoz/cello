import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Task } from "@cello/contract/entities"
import { CalendarIcon } from "lucide-react"
import { Chip } from "../components/ui/Chip.tsx"
import { PriorityIcon } from "../components/ui/PriorityIcon.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { formatDay, formatDue } from "../lib/format.ts"

/** What a card shows: key, status and title, priority, due date, labels, created date. */
export function CardBody({ task, board }: { task: Task; board: BoardState }) {
  const status = board.statuses[task.statusId]
  const labels = task.labelIds.map((id) => board.labels[id]).filter((l) => l !== undefined && l.archivedAt === null)
  return (
    <>
      <span className="text-xs tabular-nums text-muted">{task.number > 0 ? task.key : "Creating…"}</span>
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
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="flex h-5.5 items-center rounded-md border border-line px-1">
          <PriorityIcon priority={task.priority} />
        </span>
        {task.dueDate ? <Chip icon={<CalendarIcon aria-hidden className="size-3" />}>{formatDue(task.dueDate)}</Chip> : null}
        {labels.map((l) => (
          <Chip key={l!.id} color={l!.color}>
            {l!.name}
          </Chip>
        ))}
      </span>
      <span className="text-xs text-faint">Created {formatDay(task.createdAt)}</span>
    </>
  )
}
