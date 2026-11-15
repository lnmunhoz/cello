import type { Review, Task } from "@cello/contract/entities"
import { Markdown } from "../components/ui/Markdown.tsx"
import { relativeTime } from "../lib/format.ts"
import { Linkified } from "../viewer/ViewerLink.tsx"
import { Evidence } from "./Evidence.tsx"
import { ReviewActions } from "./ReviewActions.tsx"

/**
 * What an agent handed in: the summary, numbered "How to check" steps, the evidence, who submitted it
 * and when. With `decide`, Approve and Send back sit at the bottom; `onDecided` runs after either.
 *
 * One column, unless the page gives it room (`packet-wide:`, index.css): then the summary, the steps
 * and the decision sit on the left, and the evidence on the right, sticky while the left column scrolls.
 *
 * One gallery: in the image modal, ← and → step from the summary's diagrams to the screenshots.
 */
export function ReviewPacket({ task, review, decide, onDecided }: { task: Task; review: Review; decide: boolean; onDecided?: (() => void) | undefined }) {
  return (
    <div
      data-gallery=""
      className="flex flex-col gap-5 packet-wide:grid packet-wide:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] packet-wide:grid-rows-[auto_auto_1fr] packet-wide:gap-x-8"
    >
      <div className="min-w-0 packet-wide:col-start-1 packet-wide:row-start-1">
        <Markdown source={review.summary} gallery={false} />
      </div>
      <section aria-label="How to check" className="flex flex-col gap-2 packet-wide:col-start-1 packet-wide:row-start-2">
        <h4 className="text-xs font-medium text-muted">How to check</h4>
        <ol className="flex flex-col gap-1.5">
          {review.steps.map((step, i) => (
            <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-ink">
              <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold tabular-nums text-muted">
                {i + 1}
              </span>
              <span className="min-w-0 pt-px [overflow-wrap:anywhere]">
                <Linkified text={step} />
              </span>
            </li>
          ))}
        </ol>
      </section>
      {/* Wide, a column taller than the window scrolls on its own; the padding keeps focus rings inside it. */}
      <section
        aria-label="Evidence"
        className="flex flex-col gap-2 packet-wide:sticky packet-wide:top-0 packet-wide:col-start-2 packet-wide:row-span-3 packet-wide:row-start-1 packet-wide:-m-1 packet-wide:max-h-[calc(100dvh-7.5rem)] packet-wide:self-start packet-wide:overflow-y-auto packet-wide:p-1"
      >
        <h4 className="text-xs font-medium text-muted">Evidence</h4>
        <Evidence attachments={review.attachments} />
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 packet-wide:col-start-1 packet-wide:row-start-3 packet-wide:self-start">
        <span className="text-xs text-muted">
          Submitted by <span className="font-medium text-ink">{review.author.name}</span>
          {review.author.session ? <span className="tabular-nums"> · session {review.author.session.slice(0, 8)}</span> : null}
          {" · "}
          {relativeTime(review.createdAt)}
        </span>
        {decide ? <ReviewActions task={task} onDecided={onDecided} /> : null}
      </footer>
    </div>
  )
}
