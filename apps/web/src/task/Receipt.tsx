// Delivery receipts on comments (CEL-76): ticks under each of Lucas's comments (Sent, ✓ Delivered to
// 2fd0505c · 12s, ✓✓ Answered), and one line under the comment box saying where the next comment goes.
// The model is ./receipts.ts; both follow the board live (comment.delivered, session.waiting, presence).
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Comment, Task } from "@cello/contract/entities"
import { CheckCheckIcon, CheckIcon, CircleSlashIcon, ClockIcon } from "lucide-react"
import { AgentMark, type AgentMood } from "../components/ui/AgentMark.tsx"
import { useNow } from "../presence/useNow.ts"
import { durationShort, type Reach, reachOf, reachWords, receiptOf, receiptTitle, sentWords, unsentTone } from "./receipts.ts"

/** The ticks under one of Lucas's comments; nothing under an agent's. */
export function ReceiptTicks({ board, task, comment, comments }: { board: BoardState; task: Task; comment: Comment; comments: ReadonlyArray<Comment> }) {
  const now = useNow()
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
    case "sent":
      return (
        <p className={`${base} text-faint`} data-receipt="sent" title={title}>
          <ClockIcon aria-hidden className="size-3" />
          Sent · {sentWords(r, task, reachOf(board, task, now))}
        </p>
      )
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

/** The mark's pose for the line (never playing here): working while it works, waiting while it waits. */
const moodOf = (reach: Reach): AgentMood =>
  reach.kind === "nobody" || reach.presence === "ended"
    ? "still"
    : reach.waiting
    ? "waiting"
    : reach.presence === "active" || reach.worker
    ? "working"
    : "still"

/** The mark in whoever the line is about's colour while it works, amber when idle, grey when nobody or ended. */
function LineMark({ reach }: { reach: Reach }) {
  if (reach.kind === "nobody") return <AgentMark size={13} body="var(--faint)" eye="white" />
  const who = reach.worker ?? reach.who
  const body = reach.presence === "ended" ? "var(--faint)" : reach.presence === "idle" && !reach.worker ? "var(--idle)" : who.color
  return <AgentMark size={13} mood={moodOf(reach)} body={body} eye="white" />
}

const TONE = { ok: "text-muted", idle: "text-idle", warn: "text-danger" } as const

/** Under the comment box: where the next comment goes, and how soon, with the agent mark. */
export function NextCommentLine({ board, task }: { board: BoardState; task: Task }) {
  const now = useNow()
  const reach = reachOf(board, task, now)
  const { tone, text } = reachWords(reach, now)
  return (
    <p className={`mr-auto flex min-w-0 items-center gap-1.5 text-[11px] leading-4 ${TONE[tone]}`} data-next-comment={tone}>
      <LineMark reach={reach} />
      <span className="min-w-0">{text}</span>
    </p>
  )
}
