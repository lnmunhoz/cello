// Delivery receipts on comments (CEL-76): ticks under each of Lucas's comments (Sent, ✓ Delivered to
// 2fd0505c · 12s, ✓✓ Answered), and, under his latest until it's answered, a status row with the agent's
// mark, like a chat's typing indicator ("2fd0505c got your comment and is working on it…"). The model is
// ./receipts.ts; both follow the board live (comment.delivered, session.waiting, presence).
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Comment, Task } from "@cello/contract/entities"
import { CheckCheckIcon, CheckIcon, CircleSlashIcon, ClockIcon } from "lucide-react"
import { AgentMark } from "../components/ui/AgentMark.tsx"
import { useNow } from "../presence/useNow.ts"
import { type CommentStatus, commentStatus, durationShort, receiptOf, receiptTitle, sentWords, unsentTone } from "./receipts.ts"

/** The ticks under one of Lucas's comments; nothing under an agent's. */
export function ReceiptTicks({ board, task, comment, comments }: { board: BoardState; task: Task; comment: Comment; comments: ReadonlyArray<Comment> }) {
  const r = receiptOf(comment, comments, board)
  if (r === null) return null
  const base = "ml-auto flex shrink-0 items-center gap-1 text-[11px] leading-4"
  const title = receiptTitle(r)
  switch (r.state) {
    case "unsent": {
      const tone = unsentTone(comment, comments, task, board)
      return (
        <p className={`${base} ${tone === "warn" ? "text-danger" : "text-faint"}`} data-receipt="unsent" data-tone={tone} title={title}>
          <CircleSlashIcon aria-hidden className="size-3" />
          Not delivered: no agent held this task
        </p>
      )
    }
    case "sent": {
      const words = sentWords(r, task)
      return (
        <p className={`${base} text-faint`} data-receipt="sent" title={title}>
          <ClockIcon aria-hidden className="size-3" />
          Sent{words === null ? "" : ` · ${words}`}
        </p>
      )
    }
    case "delivered":
      return (
        <p className={`${base} text-muted`} data-receipt="delivered" title={title}>
          <CheckIcon aria-hidden className="size-3.5" />
          Delivered to <span className="font-medium text-ink">{r.to.short}</span> · {durationShort(r.after)}
        </p>
      )
    case "answered":
      return (
        <p className={`${base} text-answered`} data-receipt="answered" title={title}>
          <CheckCheckIcon aria-hidden className="size-3.5" />
          Answered by <span className="font-medium">{r.by.short}</span> · {durationShort(r.after)}
        </p>
      )
  }
}

/**
 * The mark in the colour of whoever works on it (a subagent on the task, else the session), amber when
 * idle, grey when nobody holds the task, it ended, or the row is about a session that let the task go.
 * It thinks (CEL-69's loop) while the holder works on the comment it took, and never plays an entry here.
 */
function StatusMark({ status: { reach, mood } }: { status: CommentStatus }) {
  if (reach === null || reach.kind === "nobody") return <AgentMark size={14} body="var(--faint)" eye="white" data-status-mark="" />
  const who = reach.worker ?? reach.who
  const body = reach.presence === "ended" ? "var(--faint)" : reach.presence === "idle" && !reach.worker ? "var(--idle)" : who.color
  return <AgentMark size={14} mood={mood} body={body} eye="white" data-status-mark="" />
}

const TONE = { ok: "text-muted", idle: "text-idle", warn: "text-danger" } as const

/** In the thread, under Lucas's latest comment until it's answered: where it stands, with the agent's mark. */
export function CommentStatusRow({ board, task, comment, comments }: { board: BoardState; task: Task; comment: Comment; comments: ReadonlyArray<Comment> }) {
  const now = useNow()
  const status = commentStatus(comment, comments, task, board, now)
  if (status === null) return null
  return (
    <li className={`flex min-w-0 items-center gap-2 px-1 text-xs leading-4 ${TONE[status.tone]}`} data-comment-status={status.tone} aria-live="polite">
      <StatusMark status={status} />
      <span className="min-w-0">{status.text}</span>
    </li>
  )
}
