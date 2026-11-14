import type { Review, Task } from "@cello/contract/entities"
import { Markdown } from "../components/ui/Markdown.tsx"
import { relativeTime } from "../lib/format.ts"
import { Evidence } from "./Evidence.tsx"
import { ReviewActions } from "./ReviewActions.tsx"

/**
 * What an agent handed in: the summary, numbered "How to check" steps, the evidence, who submitted it
 * and when. With `decide`, Approve and Send back sit at the bottom.
 */
export function ReviewPacket({ task, review, decide }: { task: Task; review: Review; decide: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <Markdown source={review.summary} />
      <section aria-label="How to check" className="flex flex-col gap-2">
        <h4 className="text-xs font-medium text-muted">How to check</h4>
        <ol className="flex flex-col gap-1.5">
          {review.steps.map((step, i) => (
            <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-ink">
              <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold tabular-nums text-muted">
                {i + 1}
              </span>
              <span className="pt-px">{step}</span>
            </li>
          ))}
        </ol>
      </section>
      <section aria-label="Evidence" className="flex flex-col gap-2">
        <h4 className="text-xs font-medium text-muted">Evidence</h4>
        <Evidence attachments={review.attachments} />
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-xs text-muted">
          Submitted by <span className="font-medium text-ink">{review.author.name}</span>
          {review.author.session ? <span className="tabular-nums"> · session {review.author.session.slice(0, 8)}</span> : null}
          {" · "}
          {relativeTime(review.createdAt)}
        </span>
        {decide ? <ReviewActions task={task} /> : null}
      </footer>
    </div>
  )
}
