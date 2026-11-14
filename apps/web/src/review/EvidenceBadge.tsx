import type { BoardState } from "@cello/client/sync/applyEvents"
import { openReviewOf, thumbnailOf } from "@cello/client/sync/reviews"
import type { Task } from "@cello/contract/entities"
import { CameraIcon } from "lucide-react"

/** On a card or list row with an open review packet: its poster or first screenshot, and how much evidence it has. */
export function EvidenceBadge({ task, board }: { task: Task; board: BoardState }) {
  const review = openReviewOf(board, task.id)
  if (!review) return null
  const thumbnail = thumbnailOf(review)
  const count = review.attachments.length
  return (
    <span
      data-evidence-badge
      aria-label={`Review packet with ${count} ${count === 1 ? "piece" : "pieces"} of evidence`}
      title="Waiting for your review"
      className="inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full border border-line pr-2 pl-0.5 text-xs text-muted"
    >
      {thumbnail ? (
        <img src={thumbnail} alt="" loading="lazy" className="h-4 w-6 rounded-full bg-sunken object-cover" />
      ) : (
        <CameraIcon aria-hidden className="ml-1 size-3" />
      )}
      <span className="tabular-nums">{count}</span>
    </span>
  )
}
