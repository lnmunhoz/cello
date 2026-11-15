import type { BoardState } from "@cello/client/sync/applyEvents"
import { openAskOf, questionCount } from "@cello/client/sync/asks"
import type { Task } from "@cello/contract/entities"
import { MessageCircleQuestionIcon } from "lucide-react"

/**
 * On a card, a list row or a Review row whose task waits on Lucas's answers (CEL-47): "Needs input",
 * with how many questions in its tooltip. With the Needs input column off, it marks those cards in In Progress.
 */
/** `count`: "3 questions" instead, where the row already says it waits on him (the Review page's Needs input group). */
export function QuestionsBadge({ task, board, count = false }: { task: Task; board: BoardState; count?: boolean }) {
  const ask = openAskOf(board, task.id)
  if (!ask) return null
  return (
    <span
      data-questions-badge
      title={`${questionCount(ask)} for you: ${ask.title}`}
      className="inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 text-xs font-medium text-accent"
    >
      <MessageCircleQuestionIcon aria-hidden className="size-3" />
      {count ? questionCount(ask) : "Needs input"}
    </span>
  )
}
