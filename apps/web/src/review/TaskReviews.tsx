import type { BoardState } from "@cello/client/sync/applyEvents"
import { openReviewOf } from "@cello/client/sync/reviews"
import type { Review, Task } from "@cello/contract/entities"
import { awaitsMerge } from "@cello/shared/review"
import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { ChevronRightIcon } from "lucide-react"
import { useState } from "react"
import { reviewsFamily } from "../lib/cello.ts"
import { relativeTime } from "../lib/format.ts"
import { ReviewActions } from "./ReviewActions.tsx"
import { ReviewPacket } from "./ReviewPacket.tsx"

/** "Claude Code session 2fd0505c": a review's relayer, named the way the CLI does. */
const relayerName = (relayedBy: NonNullable<Review["relayedBy"]>) =>
  `${relayedBy.name} session ${(relayedBy.session ?? "").slice(0, 8)}`.trim()

/**
 * The open packet, pinned at the top of the task panel with Approve and Send back. A task Lucas approved
 * that waits for its agent to merge it (Approved · merging, CEL-143) shows that instead, with Send back; when
 * he approved in the agent's chat, it says so and who passed it on (CEL-169).
 */
export function PinnedReview({ board, task }: { board: BoardState; task: Task }) {
  const result = useAtomValue(reviewsFamily(task.id))
  const review = openReviewOf(board, task.id)
  if (!review && awaitsMerge(task, board.statuses[task.statusId])) {
    const approved = AsyncResult.isSuccess(result) ? [...result.value].reverse().find((r) => r.decision === "approved") : undefined
    const relayedBy = approved?.relayedBy ?? null
    return (
      <section aria-label="Approved, merging" className="flex flex-col gap-3 rounded-lg border border-line bg-sunken p-4">
        <h3 className="text-[13px] font-semibold">Approved · merging</h3>
        <p className="text-[13px] text-muted">
          {relayedBy ? `You approved it in chat; ${relayerName(relayedBy)} passed it on. ` : "You approved it. "}
          Its agent merges it now, then moves it to Done. If the merge goes wrong, send it back with a note.
        </p>
        <div className="flex justify-end">
          <ReviewActions task={task} />
        </div>
      </section>
    )
  }
  if (!review) return null
  return (
    <section aria-label="Review packet" className="flex flex-col gap-4 rounded-lg border border-accent/40 bg-sunken p-4">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold">
        <i aria-hidden className="size-1.5 rounded-full bg-accent" />
        Waiting for your review
      </h3>
      <ReviewPacket task={task} review={review} decide />
    </section>
  )
}

const DECISIONS = { approved: "Approved", sent_back: "Sent back", superseded: "Replaced", withdrawn: "Withdrawn" } as const

/** Earlier packets, decided: newest first, each opening to the full packet. */
export function EarlierReviews({ task }: { task: Task }) {
  const result = useAtomValue(reviewsFamily(task.id))
  const decided = AsyncResult.isSuccess(result) ? [...result.value].filter((r) => r.decision !== null).reverse() : []
  if (decided.length === 0) return null
  return (
    <section aria-labelledby="reviews-heading" className="flex flex-col gap-2">
      <h3 id="reviews-heading" className="text-[13px] font-semibold">
        Earlier reviews
      </h3>
      <ul className="flex flex-col gap-1.5">
        {decided.map((r) => (
          <EarlierReview key={r.id} task={task} review={r} />
        ))}
      </ul>
    </section>
  )
}

function EarlierReview({ task, review }: { task: Task; review: Review }) {
  const [open, setOpen] = useState(false)
  return (
    <li data-review-id={review.id} className="rounded-lg border border-line bg-raised shadow-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRightIcon aria-hidden className={`size-3.5 shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="font-medium text-ink">{review.relayedBy ? "Approved in chat" : DECISIONS[review.decision!]}</span>
        <span className="text-faint">· {relativeTime(review.decidedAt ?? review.createdAt)}</span>
        {review.relayedBy ? <span className="text-faint">· relayed by {relayerName(review.relayedBy)}</span> : null}
        {review.decisionNote ? <span className="min-w-0 truncate text-muted">“{review.decisionNote}”</span> : null}
      </button>
      {open ? (
        <div className="border-t border-line px-3 py-3">
          <ReviewPacket task={task} review={review} decide={false} />
        </div>
      ) : null}
    </li>
  )
}
