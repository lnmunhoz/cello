// CEL-76 scope (removed in the real build): delivery receipts on Lucas's comments, and who will get the
// next one, picked with `?receipts=a|b|c`; the cards' activity treatment with `?activity=sweep|edge`.
// The facts come from the prototype read `scope.receipts` (which session each comment went to, when it
// took it, and the sessions with `cello inbox --wait` open); "answered" is the receiving session (or one
// of its subagents) commenting after it. The build replaces the read with a `comment.delivered` event.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Comment, Task } from "@cello/contract/entities"
import { agoShort, type Presence, presenceOf } from "@cello/shared/presence"
import { agentOn, agentPresence, agentWho, sessionWho, type Who, whoOf } from "../presence/model.ts"

export type ReceiptStyle = "a" | "b" | "c"
export type ActivityStyle = "sweep" | "edge"

/** `?receipts=a|b|c`: which receipt option shows; anything else, none (the app as it is). */
export const receiptStyle = (search: string): ReceiptStyle | null => {
  const value = new URLSearchParams(search).get("receipts")
  return value === "a" || value === "b" || value === "c" ? value : null
}

/** `?activity=sweep|edge`: which card activity treatment shows. */
export const activityStyle = (search: string): ActivityStyle | null => {
  const value = new URLSearchParams(search).get("activity")
  return value === "sweep" || value === "edge" ? value : null
}

/** One comment's delivery, as `scope.receipts` returns it. */
export interface ReceiptRow {
  readonly commentId: string
  readonly sessionId: string
  readonly readAt: number | null
}

/**
 * A comment of Lucas's, as it travels: unsent (no agent held the task, so it went nowhere), sent (in
 * the session's inbox, not taken yet), delivered (the session took it, `after` ms later), answered (the
 * session or a subagent of it commented after it, `after` ms later).
 */
export type Receipt =
  | { readonly state: "unsent" }
  | { readonly state: "sent"; readonly to: Who; readonly sessionId: string }
  | { readonly state: "delivered"; readonly to: Who; readonly sessionId: string; readonly at: number; readonly after: number }
  | { readonly state: "answered"; readonly to: Who; readonly sessionId: string; readonly by: Who; readonly at: number; readonly after: number }

/** "12s", "3m", "2h": how long something took. */
export const durationShort = (ms: number): string => {
  if (ms < 1000) return "<1s"
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

const sessionName = (board: BoardState, sessionId: string): Who => {
  const s = board.sessions[sessionId]
  return s ? sessionWho(s) : { kind: "agent", name: "an agent session", short: sessionId.slice(0, 8), color: "var(--faint)" }
}

/** A comment's receipt; null for an agent's comment (receipts are for Lucas's). */
export const receiptOf = (comment: Comment, comments: ReadonlyArray<Comment>, rows: ReadonlyArray<ReceiptRow>, board: BoardState): Receipt | null => {
  if (comment.sessionId !== null) return null
  const row = rows.find((r) => r.commentId === comment.id)
  if (!row) return { state: "unsent" }
  const to = sessionName(board, row.sessionId)
  const reply = comments.find((c) => c.sessionId === row.sessionId && c.createdAt > comment.createdAt && c.deletedAt === null)
  if (reply) {
    return {
      state: "answered", to, sessionId: row.sessionId, by: whoOf(board, reply.actorId, reply.sessionId, reply.agentId),
      at: reply.createdAt, after: reply.createdAt - comment.createdAt,
    }
  }
  if (row.readAt === null) return { state: "sent", to, sessionId: row.sessionId }
  return { state: "delivered", to, sessionId: row.sessionId, at: row.readAt, after: row.readAt - comment.createdAt }
}

/**
 * Who gets the next comment on a task: nobody (no agent holds it), or the session holding the claim,
 * with its presence, whether a `cello inbox --wait` of it is open, and the subagent working on the task
 * for it, if one is (the session, not the subagent, takes the comment).
 */
export type Reach =
  | { readonly kind: "nobody" }
  | {
    readonly kind: "agent"
    readonly sessionId: string
    readonly who: Who
    readonly presence: Presence
    readonly lastSeenAt: number
    readonly waiting: boolean
    readonly worker: Who | null
  }

export const reachOf = (board: BoardState, task: Task, waiting: ReadonlySet<string>, now: number): Reach => {
  const id = task.assigneeSessionId
  const session = id === null ? undefined : board.sessions[id]
  if (id === null || !session) return { kind: "nobody" }
  const agent = agentOn(board, task, now)
  const worker = agent && agentPresence(board, agent, now) === "active" ? agentWho(agent, session) : null
  return {
    kind: "agent", sessionId: id, who: sessionWho(session), presence: presenceOf(session, now), lastSeenAt: session.lastSeenAt,
    waiting: waiting.has(id), worker,
  }
}

/** ok: it arrives soon. idle: it waits in the inbox until the agent works again. warn: nobody will get it. */
export type ReachTone = "ok" | "idle" | "warn"

/** What the board says about who gets the next comment, and how soon. */
export const reachWords = (reach: Reach, now: number): { readonly tone: ReachTone; readonly text: string } => {
  if (reach.kind === "nobody") return { tone: "warn", text: "No agent holds this task, so nobody will get this comment." }
  const name = reach.who.short
  if (reach.presence === "ended") return { tone: "warn", text: `${name} has ended, so nobody will get this unless it resumes.` }
  if (reach.waiting) return { tone: "ok", text: `${name} is waiting for you: your comment wakes it.` }
  if (reach.presence === "active" || reach.worker) {
    return reach.worker
      ? { tone: "ok", text: `${reach.worker.short} is working on it now. ${name} gets your comment at its next step.` }
      : { tone: "ok", text: `${name} is working on it now and gets your comment at its next step.` }
  }
  return { tone: "idle", text: `${name} is idle (seen ${agoShort(reach.lastSeenAt, now)}) and isn't waiting: it gets this when it next works.` }
}
