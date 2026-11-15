import type { Task } from "@cello/contract/entities"
import { MessageSquareIcon } from "lucide-react"

/** On a card or list row whose task has comments: a speech bubble and how many, quiet. Nothing without any. */
export function CommentCount({ task }: { task: Task }) {
  if (task.commentCount === 0) return null
  const label = `${task.commentCount} ${task.commentCount === 1 ? "comment" : "comments"}`
  return (
    <span
      data-comment-count={task.commentCount}
      aria-label={label}
      title={label}
      className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-faint"
    >
      <MessageSquareIcon aria-hidden className="size-3" />
      {task.commentCount}
    </span>
  )
}
