import type { BoardState } from "@cello/client/sync/applyEvents"
import { firstEvidence, openReviewOf, thumbnailOf } from "@cello/client/sync/reviews"
import type { Task } from "@cello/contract/entities"
import { CameraIcon, PaperclipIcon } from "lucide-react"
import { openEvidence } from "./Evidence.tsx"

/**
 * sm: a pill on cards and list rows (the poster, else the first screenshot). md: a Review page row: a
 * larger thumbnail of the first screenshot (else the poster), and the count with a paperclip.
 */
const SIZES = {
  sm: {
    look: "inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full border border-line pr-2 pl-0.5 text-xs text-muted",
    thumbnail: "h-4 w-6 rounded-full bg-sunken object-cover",
    camera: "ml-1 size-3",
    prefer: "poster",
  },
  md: {
    look: "inline-flex shrink-0 items-center gap-2 text-xs text-muted",
    thumbnail: "h-10 w-16 rounded border border-line-strong bg-sunken object-cover object-top",
    camera: "size-3.5",
    prefer: "screenshot",
  },
} as const

/**
 * On a card or list row with an open review packet: a thumbnail and how much evidence it has. With
 * `opens` (cards), a click opens the first piece of evidence: a screenshot in the image modal, anything else in the viewer.
 */
export function EvidenceBadge({ task, board, opens = false, size = "sm" }: { task: Task; board: BoardState; opens?: boolean; size?: keyof typeof SIZES }) {
  const review = openReviewOf(board, task.id)
  if (!review) return null
  const style = SIZES[size]
  const thumbnail = thumbnailOf(review, style.prefer)
  const count = review.attachments.length
  const first = firstEvidence(review)
  const pieces = `${count} ${count === 1 ? "piece" : "pieces"} of evidence`
  const label = `Review packet with ${pieces}`
  const content = (
    <>
      {thumbnail ? <img src={thumbnail} alt="" loading="lazy" className={style.thumbnail} /> : <CameraIcon aria-hidden className={style.camera} />}
      {size === "md" ? (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <PaperclipIcon aria-hidden className="size-3" />
          {count}
        </span>
      ) : (
        <span className="tabular-nums">{count}</span>
      )}
    </>
  )
  if (!opens || !first) {
    return (
      <span data-evidence-badge aria-label={label} title={size === "md" ? pieces : "Waiting for your review"} className={style.look}>
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
        openEvidence(first, review.attachments, e.currentTarget)
      }}
      className={`${style.look} cursor-pointer outline-none hover:border-line-strong hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring`}
    >
      {content}
    </button>
  )
}
