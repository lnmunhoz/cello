// The card a task link shows on hover or keyboard focus (CEL-142), so a task can be read without opening
// it: its key, status, title and the card's chips; who's on it and its stage, or Nobody; what waits on
// Lucas (an ask, a packet); the first lines of its description; who made it and changed it last. Built
// from the board card's pieces. TaskKey.tsx's TaskLink wraps a link in it.
import type { BoardState } from "@cello/client/sync/applyEvents"
import { openAskOf, questionCount } from "@cello/client/sync/asks"
import { openReviewOf } from "@cello/client/sync/reviews"
import { taskOfKey } from "@cello/client/sync/selectors"
import { boardOfTaskDetail } from "@cello/client/sync/taskDetail"
import type { Task } from "@cello/contract/entities"
import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { MessageCircleQuestionIcon } from "lucide-react"
import { CardChips } from "../board/Card.tsx"
import { Markdown } from "../components/ui/Markdown.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { taskDetailFamily } from "../lib/cello.ts"
import { useBoard } from "../lib/hooks.ts"
import { PreviewWork, ProvenanceLine } from "../presence/Presence.tsx"
import { EvidenceBadge } from "../review/EvidenceBadge.tsx"
import { descriptionExcerpt } from "./excerpt.ts"
import { TaskLink } from "./TaskKey.tsx"

/**
 * The card for the task `taskKey` names: from the board when it holds the task, else read from the
 * server once (a task of another workspace).
 */
export function TaskPreviewOf({ taskKey }: { taskKey: string }) {
  const board = useBoard()
  const task = board ? taskOfKey(board, taskKey) : undefined
  if (board && task) return <TaskPreview task={task} board={board} />
  if (!board) return <PreviewNote>Loading {taskKey}…</PreviewNote>
  return <FetchedTaskPreview taskKey={taskKey} />
}

/** A task the board doesn't hold, as `task.get` reads it. */
function FetchedTaskPreview({ taskKey }: { taskKey: string }) {
  const result = useAtomValue(taskDetailFamily(taskKey))
  if (AsyncResult.isSuccess(result)) return <TaskPreview task={result.value.task} board={boardOfTaskDetail(result.value)} />
  if (AsyncResult.isFailure(result)) return <PreviewNote>No task {taskKey}</PreviewNote>
  return <PreviewNote>Loading {taskKey}…</PreviewNote>
}

function PreviewNote({ children }: { children: string | string[] }) {
  return (
    <p data-task-preview-note className="w-80 max-w-full text-xs text-muted">
      {children}
    </p>
  )
}

export function TaskPreview({ task, board }: { task: Task; board: BoardState }) {
  const status = board.statuses[task.statusId]
  const ask = openAskOf(board, task.id)
  const review = ask ? undefined : openReviewOf(board, task.id)
  const excerpt = descriptionExcerpt(task.description)
  return (
    <div data-task-preview={task.key} className="flex w-80 max-w-full flex-col gap-2">
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
        <span data-preview-key className="shrink-0 font-medium tabular-nums">
          {task.key}
        </span>
        {status ? (
          <span data-preview-status className="flex min-w-0 items-center gap-1">
            <StatusIcon category={status.category} color={status.color} size={12} />
            <span className="truncate">{status.name}</span>
          </span>
        ) : null}
      </span>
      {/* The task itself, as the link around the card opens it; no card of its own. */}
      <TaskLink
        taskKey={task.key}
        preview={false}
        data-preview-title
        className="rounded-sm text-[13px] leading-snug font-medium text-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {task.title}
      </TaskLink>
      <CardChips task={task} board={board} waiting={false} />
      <PreviewWork task={task} board={board} />
      {ask ? (
        <p data-preview-ask className="flex min-w-0 items-center gap-1.5 text-xs">
          <MessageCircleQuestionIcon aria-hidden className="size-3.5 shrink-0 text-accent" />
          <span className="shrink-0 font-medium text-accent">Needs your input · {questionCount(ask)}</span>
          <span className="truncate text-muted">{ask.title}</span>
        </p>
      ) : null}
      {review ? (
        <p data-preview-review className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <EvidenceBadge task={task} board={board} opens />
          <span className="truncate">Review packet waiting for you</span>
        </p>
      ) : null}
      {excerpt.text !== "" ? (
        <div data-preview-description className="relative max-h-36 overflow-hidden border-t border-line pt-2">
          <Markdown source={excerpt.text} gallery={false} />
          {excerpt.more ? <span data-preview-more aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-t from-raised" /> : null}
        </div>
      ) : null}
      <span className="flex min-w-0 border-t border-line pt-2">
        <ProvenanceLine task={task} board={board} />
      </span>
    </div>
  )
}
