// Delivery receipts on Lucas's comments (CEL-76), and who gets the next one. A comment says where it went
// (`delivery`: the session holding the claim when he wrote it) and when that session took it
// (`comment.delivered`); it's answered once that session, or a subagent of it, comments after it or
// reacts to it (CEL-77). Who gets the next one comes from the claim, the holder's presence (CEL-35) and
// whether a `cello inbox --wait` of it is open (`waiting`). Under Lucas's latest comment, until it's
// answered, a status row says where it stands, like a chat's typing indicator (commentStatus).
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Comment, DeliveryVia, Task } from "@cello/contract/entities"
import { type Presence, presenceOf } from "@cello/shared/presence"
import { agentOn, agentPresence, agentWho, sessionWho, type Who, whoOf } from "../presence/model.ts"

/**
 * One of Lucas's comments, as it travels: unsent (no agent held the task, so it went nowhere), sent (in
 * the session's inbox, not taken yet), delivered (the session took it, `after` ms later), answered (the
 * session or a subagent of it commented or reacted after taking it, `after` ms after it was written).
 */
export type Receipt =
  | { readonly state: "unsent" }
  | { readonly state: "sent"; readonly to: Who; readonly sessionId: string }
  | { readonly state: "delivered"; readonly to: Who; readonly sessionId: string; readonly at: number; readonly after: number; readonly via: DeliveryVia | null }
  | { readonly state: "answered"; readonly to: Who; readonly by: Who; readonly at: number; readonly after: number; readonly emoji: string | null }

/** "<1s", "12s", "3m", "2h": how long something took. */
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

/** A comment's receipt; null for an agent's own comment (receipts are for Lucas's). */
export const receiptOf = (comment: Comment, comments: ReadonlyArray<Comment>, board: BoardState): Receipt | null => {
  if (comment.sessionId !== null) return null
  const delivery = comment.delivery ?? null
  if (delivery === null) return { state: "unsent" }
  const to = sessionName(board, delivery.sessionId)
  // Only what the session wrote once it had the comment answers it: a reply typed before it took it
  // was about something else.
  const readAt = delivery.readAt
  const reply = readAt === null
    ? undefined
    : comments.find((c) => c.sessionId === delivery.sessionId && c.createdAt >= readAt && c.createdAt > comment.createdAt && c.deletedAt === null)
  const reaction = readAt === null ? undefined : (comment.reactions ?? []).find((r) => r.sessionId === delivery.sessionId && r.createdAt >= readAt)
  const answer = reply && (!reaction || reply.createdAt <= reaction.createdAt)
    ? { by: whoOf(board, reply.actorId, reply.sessionId, reply.agentId), at: reply.createdAt, emoji: null }
    : reaction
    ? { by: whoOf(board, reaction.actorId, reaction.sessionId, reaction.agentId), at: reaction.createdAt, emoji: reaction.emoji }
    : null
  if (answer) return { state: "answered", to, ...answer, after: answer.at - comment.createdAt }
  if (readAt === null) return { state: "sent", to, sessionId: delivery.sessionId }
  return { state: "delivered", to, sessionId: delivery.sessionId, at: readAt, after: readAt - comment.createdAt, via: delivery.via }
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
    readonly who: Who
    readonly presence: Presence
    readonly lastSeenAt: number
    readonly waiting: boolean
    readonly worker: Who | null
  }

export const reachOf = (board: BoardState, task: Task, now: number): Reach => {
  const id = task.assigneeSessionId
  const session = id === null ? undefined : board.sessions[id]
  if (!session) return { kind: "nobody" }
  const agent = agentOn(board, task, now)
  const worker = agent && agentPresence(board, agent, now) === "active" ? agentWho(agent, session) : null
  return {
    kind: "agent",
    who: sessionWho(session),
    presence: presenceOf(session, now),
    lastSeenAt: session.lastSeenAt,
    waiting: session.waiting === true,
    worker,
  }
}

/** ok: it arrives soon, or is being worked on. idle: it waits until the agent works again. warn: nobody will get it. */
export type ReachTone = "ok" | "idle" | "warn"

/** The holder takes comments while it, or a subagent of it on the task, is active. */
const working = (reach: Extract<Reach, { kind: "agent" }>): boolean => reach.presence === "active" || reach.worker !== null

/**
 * How soon a comment not taken yet reaches whoever holds the task. The session, not a subagent working
 * for it, takes comments, so it's the one named.
 */
export const reachWords = (reach: Reach): { readonly tone: ReachTone; readonly text: string } => {
  if (reach.kind === "nobody") return { tone: "warn", text: "No agent holds this task: nobody will get this" }
  const name = reach.who.short
  if (reach.presence === "ended") return { tone: "idle", text: `${name} ended: it gets this if the session is resumed` }
  if (reach.waiting) return { tone: "ok", text: `${name} is waiting for you: it gets this in about a second` }
  if (working(reach)) return { tone: "ok", text: `${name} gets this at its next step` }
  return { tone: "idle", text: `${name} is idle: it gets this when it next works` }
}

/**
 * What the Sent tick adds: nothing while the comment went to the holder (the status row under it says how
 * soon), or, once the claim has moved on from the session it went to, the inbox it waits in.
 */
export const sentWords = (r: Extract<Receipt, { state: "sent" }>, task: Task): string | null =>
  r.sessionId === task.assigneeSessionId ? null : `waiting in ${r.to.short}'s inbox; ${r.to.short} no longer holds this task`

/** The comment the status row follows: Lucas's latest, even with agents' comments after it. */
export const statusCommentId = (comments: ReadonlyArray<Comment>): string | null =>
  comments.findLast((c) => c.sessionId === null && c.deletedAt === null)?.id ?? null

/**
 * The row's mark: thinking (it loops) only while the holder works on the comment it took, waiting's pose
 * (big eyes, not moving) while it waits in `cello inbox --wait`, else still. Animations run only while
 * an agent works (AGENTS.md).
 */
export type StatusMood = "thinking" | "waiting" | "still"

/**
 * The status row under Lucas's latest comment, until it's answered: how soon the holder gets it, that it
 * got it and is working on it, or that nobody will. `reach` is the holder the row is about (its mark), or
 * null when it's about a session that no longer holds the task.
 */
export interface CommentStatus {
  readonly tone: ReachTone
  readonly text: string
  readonly reach: Reach | null
  readonly mood: StatusMood
}

/** The pose for a row that isn't about working on the comment: waiting's while it waits, else still. */
const restingMood = (reach: Reach | null): StatusMood =>
  reach !== null && reach.kind === "agent" && reach.presence !== "ended" && reach.waiting ? "waiting" : "still"

export const commentStatus = (comment: Comment, comments: ReadonlyArray<Comment>, task: Task, board: BoardState, now: number): CommentStatus | null => {
  const r = receiptOf(comment, comments, board)
  if (r === null || r.state === "answered") return null
  const reach = reachOf(board, task, now)
  switch (r.state) {
    case "unsent":
      // Claimed after it was written, it still went nowhere: its tick says so, and no row says otherwise.
      return reach.kind === "nobody" && unsentTone(comment, comments, task, board) === "warn"
        ? { ...reachWords(reach), reach, mood: "still" }
        : null
    case "sent":
      // Waiting in a session that let the task go: its tick names that inbox.
      return r.sessionId === task.assigneeSessionId ? { ...reachWords(reach), reach, mood: restingMood(reach) } : null
    case "delivered": {
      const holder = reach.kind === "agent" && r.sessionId === task.assigneeSessionId ? reach : null
      // A holder waiting in `cello inbox --wait` has ended its turn: it's waiting for Lucas, not working on
      // it. The wait that hands a comment over ends it: the server tells the boards the session woke, seen
      // at that moment, in the same change as the delivery (SessionService.wokeWithin).
      return holder && working(holder) && !holder.waiting
        ? { tone: "ok", text: `${r.to.short} got your comment and is working on it…`, reach: holder, mood: "thinking" }
        : { tone: "idle", text: `${r.to.short} got your comment but hasn't answered yet`, reach: holder, mood: restingMood(holder) }
    }
  }
}

/** When receipts started (CEL-76): a comment from before can't say where it went. */
export const RECEIPTS_SINCE = Date.UTC(2026, 10, 16)

/**
 * How loud "Not delivered" is: a warning (`warn`) where an agent could have taken the comment (the task
 * is open and agents work on it), else quiet (a Done task, one no agent ever touched, a comment from
 * before receipts).
 */
export const unsentTone = (comment: Comment, comments: ReadonlyArray<Comment>, task: Task, board: BoardState): "warn" | "quiet" => {
  const category = board.statuses[task.statusId]?.category
  if (category === "completed" || category === "canceled" || comment.createdAt < RECEIPTS_SINCE) return "quiet"
  const agentsOnIt = task.assigneeSessionId !== null || task.createdBySessionId !== null || task.updatedBySessionId !== null ||
    comments.some((c) => c.sessionId !== null || (c.delivery ?? null) !== null)
  return agentsOnIt ? "warn" : "quiet"
}

const VIA: Record<DeliveryVia, string> = { hook: "its hook", inbox: "cello inbox", wait: "its waiting cello inbox --wait" }

/** The tick's hover: who took it, how and when. */
export const receiptTitle = (r: Receipt): string => {
  switch (r.state) {
    case "unsent":
      return "No agent held this task when you wrote it, so nobody got it"
    case "sent":
      return `Waiting in ${r.to.name}'s inbox`
    case "delivered":
      return `${r.to.name} took it ${durationShort(r.after)} after you sent it${r.via ? `, through ${VIA[r.via]}` : ""}`
    case "answered":
      return `${r.by.name} ${r.emoji ? `reacted ${r.emoji}` : "answered"} ${durationShort(r.after)} after you sent it`
  }
}
