import type { BoardState } from "@cello/client/sync/applyEvents"
import { openAskOf } from "@cello/client/sync/asks"
import { openReviewOf } from "@cello/client/sync/reviews"
import type { Task } from "@cello/contract/entities"
import { CalendarIcon, ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Chip } from "../components/ui/Chip.tsx"
import { PriorityIcon } from "../components/ui/PriorityIcon.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { formatDue } from "../lib/format.ts"
import { ActivityEdge, useCardActivity } from "../presence/Activity.tsx"
import { CardWork, ProvenanceLine } from "../presence/Presence.tsx"
import { QuestionsBadge } from "../ask/QuestionsBadge.tsx"
import { EvidenceBadge } from "../review/EvidenceBadge.tsx"
import { CommentCount } from "../task/CommentCount.tsx"

/**
 * What a card shows: key and parent breadcrumb, status and title, then priority, due date and labels
 * (a row only when there is one of them), who's on it and its stage (CEL-35), and who made it and
 * changed or commented on it last (CEL-5), with its comment count. While an agent is at work on it, an
 * edge in its colour (CEL-76). `laned`: its column's lanes already say the stage. `work={false}`: no
 * work line, where the page around the card already names the agent (the Agents page, CEL-65).
 * `titleLink`: wraps the title, for a card that is a container with its title as the link.
 */
export function CardBody({ task, board, laned = false, work = true, titleLink }: {
  task: Task
  board: BoardState
  laned?: boolean
  work?: boolean
  titleLink?: (title: string) => ReactNode
}) {
  const status = board.statuses[task.statusId]
  // An agent at work on it right now (CEL-76): the edge, and the status icon's turn per check-in.
  const activity = useCardActivity(task, board)
  const parent = task.parentId ? board.tasks[task.parentId] : undefined
  const labels = task.labelIds.map((id) => board.labels[id]).filter((l) => l !== undefined && l.archivedAt === null)
  const chips = task.priority !== 0 || task.dueDate !== null || labels.length > 0 || openReviewOf(board, task.id) !== undefined ||
    openAskOf(board, task.id) !== undefined
  return (
    <>
      <ActivityEdge activity={activity} />
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
            <StatusIcon category={status.category} color={status.color} turn={activity.plays} />
          </span>
        ) : null}
        <span className="text-[13px] leading-snug font-medium text-ink" data-card-title>
          {titleLink ? titleLink(task.title) : task.title}
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
          <QuestionsBadge task={task} board={board} />
          <EvidenceBadge task={task} board={board} opens />
        </span>
      ) : null}
      {work ? <CardWork task={task} board={board} stage={!laned} /> : null}
      <span className="flex min-w-0 items-center justify-between gap-2">
        <ProvenanceLine task={task} board={board} />
        <CommentCount task={task} />
      </span>
    </>
  )
}
