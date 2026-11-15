import type { BoardState } from "@cello/client/sync/applyEvents"
import { firstEvidence, openReviewOf, thumbnailOf } from "@cello/client/sync/reviews"
import type { Task } from "@cello/contract/entities"
import { CameraIcon } from "lucide-react"
import { openEvidence } from "./Evidence.tsx"

/** sm: a pill on cards and list rows. md: a larger thumbnail, for a Review page row. */
const SIZES = {
  sm: {
    look: "inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full border border-line pr-2 pl-0.5 text-xs text-muted",
    thumbnail: "h-4 w-6 rounded-full bg-sunken object-cover",
    camera: "ml-1 size-3",
  },
  md: {
    look: "inline-flex shrink-0 items-center gap-1.5 text-xs text-muted",
    thumbnail: "h-8 w-12 rounded border border-line bg-sunken object-cover object-top",
    camera: "size-3.5",
  },
} as const

/**
 * On a card or list row with an open review packet: its poster or first screenshot, and how much
 * evidence it has. With `opens` (cards), a click opens the first piece of evidence in the viewer.
 */
export function EvidenceBadge({ task, board, opens = false, size = "sm" }: { task: Task; board: BoardState; opens?: boolean; size?: keyof typeof SIZES }) {
  const review = openReviewOf(board, task.id)
  if (!review) return null
  const thumbnail = thumbnailOf(review)
  const count = review.attachments.length
  const first = firstEvidence(review)
  const label = `Review packet with ${count} ${count === 1 ? "piece" : "pieces"} of evidence`
  const { look, ...style } = SIZES[size]
  const content = (
    <>
      {thumbnail ? <img src={thumbnail} alt="" loading="lazy" className={style.thumbnail} /> : <CameraIcon aria-hidden className={style.camera} />}
      <span className="tabular-nums">{count}</span>
    </>
  )
  if (!opens || !first) {
    return (
      <span data-evidence-badge aria-label={label} title="Waiting for your review" className={look}>
        {content}
      </span>
    )
  }
  const name = first.caption || first.name
  return (
    // Inside a draggable card that opens its task on click: the badge keeps its press, click and keys
    // to itself. Out of the Tab order, so the board's arrow-key focus stays on cards (the packet is in the task too).
    <button
      type="button"
      tabIndex={-1}
      data-evidence-badge
      aria-label={`${label}: open ${name}`}
      title={`Open ${name}`}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") e.stopPropagation()
      }}
      onClick={(e) => {
        e.stopPropagation()
        openEvidence(first)
      }}
      className={`${look} cursor-pointer outline-none hover:border-line-strong hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring`}
    >
      {content}
    </button>
  )
}
