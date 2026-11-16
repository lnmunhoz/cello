// CEL-76 scope (removed in the real build): three ways to show whether Lucas's comment reached the agent,
// picked with `?receipts=a|b|c`. The model is ./receipts.ts; the facts come from the prototype read
// `scope.receipts`, fetched again on every board event (the build pushes a `comment.delivered` event).
//
//   A · Messenger ticks: "Sent", "✓ Delivered to 2fd0505c · 12s", "✓✓ Answered by cello-builder · 3m"
//       under each of Lucas's comments, and a warning above the box when nobody will get the next one.
//   B · Inline status line: a sentence with the agent mark under each comment ("2fd0505c took this 12s
//       after you sent it · cello-builder is working on it now"), and one line under the box.
//   C · Thread banner: one banner above the box ("cello-builder is working on this task · read your
//       comments 1m ago"), and a small dot by each comment's time.
import type { BoardState } from "@cello/client/sync/applyEvents"
import { CelloClient } from "@cello/client/client"
import type { Comment, Task } from "@cello/contract/entities"
import { useAtomValue } from "@effect/atom-react"
import { agoShort } from "@cello/shared/presence"
import * as Effect from "effect/Effect"
import * as Atom from "effect/reactivity/Atom"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { AlertTriangleIcon, CheckCheckIcon, CheckIcon, CircleSlashIcon, ClockIcon, MoonIcon } from "lucide-react"
import type { ReactNode } from "react"
import { AgentMark, type AgentMood } from "../components/ui/AgentMark.tsx"
import { commentsFamily, runtime, syncedAtom } from "../lib/cello.ts"
import { useNow } from "../presence/useNow.ts"
import { durationShort, type Reach, reachOf, reachWords, type Receipt, receiptOf, type ReceiptStyle } from "./receipts.ts"
import { currentReceiptStyle } from "./switch.ts"
import "./scope.css"

/** A task's receipts, fetched again on every board event (the prototype has no event of its own). */
const receiptsFamily = Atom.family((taskId: string) =>
  runtime.atom((get) => {
    const synced = get(syncedAtom)
    const seq = AsyncResult.isSuccess(synced) ? synced.value.state.seq : 0
    get(commentsFamily(taskId))
    return Effect.gen(function* () {
      void seq
      const client = yield* CelloClient
      return yield* client["scope.receipts"]({ taskId })
    })
  }))

export interface ReceiptScope {
  /** Under a comment (A's ticks, B's line); null for none. */
  readonly under: (comment: Comment) => ReactNode
  /** By a comment's time (C's dot). */
  readonly dot: (comment: Comment) => ReactNode
  /** Above the comment box (A's warning, C's banner). */
  readonly above: ReactNode
  /** Beside the Comment button (B's line). */
  readonly hint: ReactNode
}

/** The receipts for the option `?receipts=` picks, or null (the app as it is). */
export function useReceiptScope(board: BoardState, task: Task, comments: ReadonlyArray<Comment>): ReceiptScope | null {
  const style = currentReceiptStyle()
  const result = useAtomValue(receiptsFamily(task.id))
  const now = useNow()
  if (style === null) return null
  const facts = AsyncResult.isSuccess(result) ? result.value : { items: [], waiting: [] }
  const reach = reachOf(board, task, new Set(facts.waiting), now)
  const receipt = (c: Comment) => receiptOf(c, comments, facts.items, board)
  // The latest time the holder took one of Lucas's comments, for C's banner.
  const lastRead = reach.kind === "agent"
    ? Math.max(0, ...facts.items.filter((r) => r.sessionId === reach.sessionId && r.readAt !== null).map((r) => r.readAt!))
    : 0
  return {
    under: (c) => {
      const r = receipt(c)
      if (r === null) return null
      if (style === "a") return <Ticks receipt={r} reach={reach} />
      if (style === "b") return <StatusLine receipt={r} reach={reach} />
      return null
    },
    dot: (c) => {
      const r = receipt(c)
      return style === "c" && r !== null ? <Dot receipt={r} /> : null
    },
    above: style === "a" ? <Warning reach={reach} now={now} /> : style === "c" ? <Banner reach={reach} lastRead={lastRead} now={now} /> : null,
    hint: style === "b" ? <Hint reach={reach} now={now} /> : null,
  }
}

/** The mark for whoever the line is about: in its colour while it works, amber when idle, grey once gone. */
function Mark({ reach, mood, size = 14 }: { reach: Reach; mood?: AgentMood; size?: number }) {
  if (reach.kind === "nobody") return <AgentMark size={size} body="var(--faint)" eye="white" />
  const who = reach.worker ?? reach.who
  const body = reach.presence === "ended" ? "var(--faint)" : reach.presence === "idle" && !reach.worker ? "var(--idle)" : who.color
  return <AgentMark size={size} mood={mood ?? moodOf(reach)} body={body} eye="white" />
}

/** The mark's pose (still, never playing here): working while it works, waiting while it waits for Lucas. */
const moodOf = (reach: Reach): AgentMood =>
  reach.kind === "nobody" || reach.presence === "ended" ? "still" : reach.waiting ? "waiting" : reach.presence === "active" || reach.worker ? "working" : "still"

/** What's left to say about a comment not taken yet: when it will be. */
const pendingWords = (reach: Reach) =>
  reach.kind === "nobody"
    ? "nobody holds the task now"
    : reach.presence === "ended"
    ? `${reach.who.short} has ended`
    : reach.waiting
    ? `${reach.who.short} wakes on it`
    : reach.presence === "active" || reach.worker
    ? `${reach.who.short} gets it at its next step`
    : `${reach.who.short} is idle, gets it when it next works`

// ---------- A · Messenger ticks ----------

function Ticks({ receipt: r, reach }: { receipt: Receipt; reach: Reach }) {
  const base = "flex items-center justify-end gap-1 text-[11px] leading-4"
  if (r.state === "unsent") {
    return (
      <p className={`${base} text-danger`} data-receipt="unsent">
        <CircleSlashIcon aria-hidden className="size-3" />
        Not delivered: no agent held this task
      </p>
    )
  }
  if (r.state === "sent") {
    return (
      <p className={`${base} text-faint`} data-receipt="sent" title={pendingWords(reach)}>
        <ClockIcon aria-hidden className="size-3" />
        Sent · {pendingWords(reach)}
      </p>
    )
  }
  if (r.state === "delivered") {
    return (
      <p className={`${base} text-muted`} data-receipt="delivered">
        <CheckIcon aria-hidden className="size-3.5" />
        Delivered to <span className="font-medium text-ink">{r.to.short}</span> · {durationShort(r.after)}
      </p>
    )
  }
  return (
    <p className={`${base} receipt-ok`} data-receipt="answered">
      <CheckCheckIcon aria-hidden className="size-3.5" />
      Answered by <span className="font-medium">{r.by.short}</span> · {durationShort(r.after)}
    </p>
  )
}

/** Above the box, only when the next comment won't arrive soon: amber when it waits, red when nobody gets it. */
function Warning({ reach, now }: { reach: Reach; now: number }) {
  const { tone, text } = reachWords(reach, now)
  if (tone === "ok") return null
  const Icon = tone === "warn" ? AlertTriangleIcon : MoonIcon
  return (
    <p className="receipt-warning flex items-start gap-2 rounded-lg px-3 py-2 text-xs" data-reach-warning={tone}>
      <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{text}</span>
    </p>
  )
}

// ---------- B · Inline status line ----------

function StatusLine({ receipt: r, reach }: { receipt: Receipt; reach: Reach }) {
  const now = reach.kind === "agent" && (reach.presence === "active" || reach.worker) ? ` · ${(reach.worker ?? reach.who).short} is working on it now` : ""
  let text: ReactNode
  let mood: AgentMood = "still"
  if (r.state === "unsent") text = <>Nobody got this: no agent held the task when you wrote it</>
  else if (r.state === "sent") {
    text = <>Waiting to be read: {pendingWords(reach)}</>
    mood = moodOf(reach)
  } else if (r.state === "delivered") {
    text = (
      <>
        <span className="font-medium text-ink">{r.to.short}</span> took this {durationShort(r.after)} after you sent it{now}
      </>
    )
    mood = moodOf(reach)
  } else {
    text = (
      <>
        <span className="font-medium text-ink">{r.by.short}</span> answered {durationShort(r.after)} later, below
      </>
    )
  }
  return (
    <p className="-mx-3 -mb-2.5 mt-0.5 flex items-center gap-1.5 border-t border-line px-3 py-1.5 text-[11px] text-muted" data-receipt={r.state}>
      {r.state === "unsent" ? <AgentMark size={13} body="var(--faint)" eye="white" /> : <Mark reach={reach} mood={mood} size={13} />}
      <span className="min-w-0 truncate">{text}</span>
    </p>
  )
}

/** Under the box: where the next comment goes, in words, with the mark. */
function Hint({ reach, now }: { reach: Reach; now: number }) {
  const { tone, text } = reachWords(reach, now)
  return (
    <p className={`mr-auto flex min-w-0 items-center gap-1.5 text-[11px] ${tone === "warn" ? "text-danger" : tone === "idle" ? "text-idle" : "text-muted"}`} data-reach-hint={tone}>
      <Mark reach={reach} size={13} />
      <span className="min-w-0">{text}</span>
    </p>
  )
}

// ---------- C · Thread banner ----------

function Banner({ reach, lastRead, now }: { reach: Reach; lastRead: number; now: number }) {
  const { tone } = reachWords(reach, now)
  const read = lastRead > 0 ? ` · read your comments ${agoShort(lastRead, now)}` : ""
  // The title names who and what; the line under it, what happens to the next comment.
  const text = reach.kind === "nobody"
    ? "Nobody will get a comment until an agent claims it."
    : reach.presence === "ended"
    ? "Nobody will get this unless the session resumes."
    : reach.waiting
    ? "Your comment wakes it."
    : reach.presence === "active" || reach.worker
    ? `${reach.who.short} gets your comment at its next step.`
    : `Seen ${agoShort(reach.lastSeenAt, now)} and not waiting: it gets this when it next works.`
  const title = reach.kind === "nobody"
    ? "Nobody is on this task"
    : reach.presence === "ended"
    ? `${reach.who.short} has ended`
    : reach.waiting
    ? `${reach.who.short} is waiting for you`
    : reach.presence === "active" || reach.worker
    ? `${(reach.worker ?? reach.who).short} is active on this task`
    : `${reach.who.short} is idle`
  return (
    <div className="receipt-banner flex items-center gap-2.5 rounded-lg px-3 py-2" data-reach-banner={tone}>
      <Mark reach={reach} size={18} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium text-ink">
          {title}
          <span className="font-normal text-muted">{tone === "ok" ? read : ""}</span>
        </span>
        <span className="text-[11px] text-muted">{text}</span>
      </span>
    </div>
  )
}

const DOT_TITLE: Record<Receipt["state"], string> = {
  unsent: "Not delivered: no agent held the task",
  sent: "Sent, not read yet",
  delivered: "Delivered",
  answered: "Answered",
}

function Dot({ receipt: r }: { receipt: Receipt }) {
  const label = r.state === "delivered" ? `Delivered to ${r.to.short} · ${durationShort(r.after)}` : r.state === "answered" ? `Answered by ${r.by.short}` : DOT_TITLE[r.state]
  return <span className="receipt-dot" data-receipt={r.state} title={label} aria-label={label} role="img" />
}

export type { ReceiptStyle }
