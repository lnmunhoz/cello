import type { BoardState } from "@cello/client/sync/applyEvents"
import { openReviewOf } from "@cello/client/sync/reviews"
import { awaitsMerge, holdsPacket } from "@cello/domain/review"
import type { Standing } from "./queue.ts"

/**
 * What the board says now about a task a decision was made on (CEL-191): its open packet, and whether
 * the task still waits on Lucas. Read from the board itself, not from the Review queue, which also drops
 * a task for reasons that don't touch the decision (an agent's question, an archived project).
 */
export const standingOf = (board: BoardState, taskId: string): Standing => {
  const task = board.tasks[taskId]
  const status = task ? board.statuses[task.statusId] : undefined
  return {
    reviewId: openReviewOf(board, taskId)?.id ?? null,
    waiting: task !== undefined && status !== undefined && holdsPacket(status) && !awaitsMerge(task, status),
  }
}
