// Agent inboxes (CEL-15). A human comment on a task is delivered, inside the comment's command, to the
// agent session holding the task's claim at that moment. A Send back note goes the same way, and when
// a human change ended the claim during review, to the session that submitted the packet. Lucas's
// answers to an ask (CEL-47) go to the claim holder too, else to the session that asked. Agents'
// comments (their own or another session's) are never delivered, and nothing reaches a session after
// its claim ends. `take` hands the new items over and marks them read in one statement, so each item
// reaches the session once, even when several hooks ask at the same time. Read marks belong to the
// session, not the board, so they write no events (like a session's `last_seen_at`). `wait` (CEL-74)
// blocks until there is something to take, so an idle agent session (`cello inbox --wait` running in
// its background) wakes when Lucas writes. Lucas's emoji reaction to an agent's comment (CEL-77) reaches
// the session that wrote it, else the claim holder; the reaction row itself is the item
// (`comment_reactions.notify_session_id`, `read_at`), so the inbox reads both tables.
import type { Ask, Comment, InboxItem, Reaction } from "@cello/contract/entities"
import { Caller } from "@cello/contract/rpcs"
import type { Inbox } from "@cello/contract/views"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import { formatTaskKey } from "@cello/shared/taskKey"
import type * as Commands from "../commands/Commands.ts"
import * as EventLog from "../events/EventLog.ts"
import { newId } from "../persistence/ids.ts"
import { selectInboxItems, selectReactionItems } from "../persistence/rows.ts"
import * as Seed from "../persistence/Seed.ts"
import { SessionService } from "../session/SessionService.ts"

/** How many items read before `take` returns as `earlier`. */
export const EARLIER = 10

export class InboxService extends Context.Service<InboxService, {
  /**
   * Hands the caller its new items and marks them read, atomically: a second take, even a concurrent
   * one, never gets the same item. Also returns the latest read ones unless `unreadOnly`. Empty for the human.
   */
  readonly take: (query: { readonly unreadOnly?: boolean }) => Effect.Effect<Inbox, never, Caller>
  /**
   * Waits until the caller has new items, then takes them as `take({ unreadOnly: true })` does. At once
   * when some are waiting, and for the human (empty). Every change on the board that commits wakes it
   * to try again; items a live `handOverAnswers` holds stay with it, as they do for `take`.
   */
  readonly wait: Effect.Effect<Inbox, never, Caller>
  /** The caller's new items, oldest first, left new (for `context`, which subagents run too). */
  readonly unread: Effect.Effect<ReadonlyArray<InboxItem>, never, Caller>
  /**
   * For the command that adds a comment: delivers it, in that command's transaction, to whoever should
   * get it (see the top of this file). `send_back` is a review's note, added by the same command.
   */
  readonly deliverWithin: (context: Commands.WriteContext, comment: Comment, kind: "comment" | "send_back") => Effect.Effect<void, SqlError>
  /**
   * For the command that answers an ask (CEL-47): delivers the answers, in that command's
   * transaction, to the session holding the task's claim, else to the session that asked.
   */
  readonly deliverAnswersWithin: (context: Commands.WriteContext, ask: Ask) => Effect.Effect<void, SqlError>
  /**
   * For the command in which Lucas moved a card out of Needs input himself (CEL-47): tells the session
   * that asked that its ask was withdrawn, and where the card went (`status`). Agents' moves tell no one.
   */
  readonly deliverWithdrawalWithin: (context: Commands.WriteContext, ask: Ask, status: string) => Effect.Effect<void, SqlError>
  /**
   * For the command in which the human reacted to a comment (CEL-77): when an agent session wrote it,
   * the reaction becomes that session's inbox item, or the claim holder's once that session ended.
   * Agents' reactions tell no one. Removing the reaction (its row) before it's read takes the item back.
   */
  readonly deliverReactionWithin: (context: Commands.WriteContext, comment: Comment, reaction: Reaction) => Effect.Effect<void, SqlError>
  /**
   * Runs `wait` (until an ask closes) and hands its answers over: the caller's inbox item for them is
   * marked read, and while it runs `take` leaves that item alone, so the hook never prints them too.
   */
  readonly handOverAnswers: <A extends { readonly id: string }, E, R>(askId: string, wait: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R | Caller>
}>()("cello/InboxService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const sessions = yield* SessionService
  const log = yield* EventLog.EventLog
  const human = yield* Seed.HumanActor

  /** Who gets a human comment: the task's claim holder, else for a Send back the packet's submitter. */
  const recipientOf = (context: Commands.WriteContext, comment: Comment, kind: "comment" | "send_back") =>
    Effect.gen(function* () {
      const [task] = yield* sql<{ assignee_session_id: string | null }>`SELECT assignee_session_id FROM tasks WHERE id = ${comment.taskId}`
      if (task?.assignee_session_id) return task.assignee_session_id
      if (kind !== "send_back") return null
      // The review this command just sent back.
      const [review] = yield* sql<{ session_id: string | null }>`
        SELECT session_id FROM reviews WHERE task_id = ${comment.taskId} AND decision = 'sent_back' AND decided_at = ${context.now}
        ORDER BY created_at DESC LIMIT 1`
      return review?.session_id ?? null
    })

  const deliverWithin = (context: Commands.WriteContext, comment: Comment, kind: "comment" | "send_back") =>
    Effect.gen(function* () {
      if (context.caller.sessionId !== null) return
      const sessionId = yield* recipientOf(context, comment, kind)
      if (sessionId === null) return
      yield* sql`INSERT INTO inbox_items (id, session_id, comment_id, task_id, kind, created_at)
        VALUES (${newId(context.now)}, ${sessionId}, ${comment.id}, ${comment.taskId}, ${kind}, ${comment.createdAt})
        ON CONFLICT (session_id, comment_id) DO NOTHING`
    }).pipe(Effect.withSpan("InboxService.deliverWithin"))

  const deliverAnswersWithin = (context: Commands.WriteContext, ask: Ask) =>
    Effect.gen(function* () {
      const [task] = yield* sql<{ assignee_session_id: string | null }>`SELECT assignee_session_id FROM tasks WHERE id = ${ask.taskId}`
      const sessionId = task?.assignee_session_id ?? ask.sessionId
      if (sessionId === null) return
      yield* sql`INSERT INTO inbox_items (id, session_id, ask_id, task_id, kind, created_at)
        VALUES (${newId(context.now)}, ${sessionId}, ${ask.id}, ${ask.taskId}, 'answers', ${context.now})
        ON CONFLICT (session_id, ask_id) DO NOTHING`
    }).pipe(Effect.withSpan("InboxService.deliverAnswersWithin"))

  const deliverWithdrawalWithin = (context: Commands.WriteContext, ask: Ask, status: string) =>
    Effect.gen(function* () {
      if (context.caller.sessionId !== null || ask.sessionId === null) return
      yield* sql`INSERT INTO inbox_items (id, session_id, ask_id, task_id, kind, detail, created_at)
        VALUES (${newId(context.now)}, ${ask.sessionId}, ${ask.id}, ${ask.taskId}, 'withdrawn', ${status}, ${context.now})
        ON CONFLICT (session_id, ask_id) DO NOTHING`
    }).pipe(Effect.withSpan("InboxService.deliverWithdrawalWithin"))

  const deliverReactionWithin = (context: Commands.WriteContext, comment: Comment, reaction: Reaction) =>
    Effect.gen(function* () {
      if (context.caller.sessionId !== null || comment.sessionId === null) return
      const [author] = yield* sql<{ ended_at: number | null }>`SELECT ended_at FROM agent_sessions WHERE id = ${comment.sessionId}`
      const [task] = yield* sql<{ assignee_session_id: string | null }>`SELECT assignee_session_id FROM tasks WHERE id = ${comment.taskId}`
      const sessionId = author && author.ended_at === null ? comment.sessionId : task?.assignee_session_id ?? null
      if (sessionId === null) return
      yield* sql`UPDATE comment_reactions SET notify_session_id = ${sessionId} WHERE id = ${reaction.id}`
    }).pipe(Effect.withSpan("InboxService.deliverReactionWithin"))

  /** Items from both tables, oldest first; ids are time-ordered, so they break ties. */
  const inOrder = (items: ReadonlyArray<InboxItem>) =>
    [...items].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // Asks a session is waiting on right now ("<session> <ask>" → how many waits): `take` leaves their
  // items to the wait, so the answers aren't handed over twice (the hook firing between the commit and
  // the wait's own mark). A wait that ends without marking (interrupted) lets go, and the hook gets them.
  const held = new Map<string, number>()
  const heldBy = (sessionId: string) =>
    [...held.keys()].flatMap((k) => (k.startsWith(`${sessionId} `) ? [k.slice(sessionId.length + 1)] : []))

  const handOverAnswers = <A extends { readonly id: string }, E, R>(askId: string, wait: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const caller = yield* Caller
      if (caller.sessionId === null) return yield* wait
      const k = `${caller.sessionId} ${askId}`
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => void held.set(k, (held.get(k) ?? 0) + 1)),
        () =>
          Effect.tap(wait, () =>
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis
              yield* sql`UPDATE inbox_items SET read_at = ${now} WHERE ask_id = ${askId} AND session_id = ${caller.sessionId} AND read_at IS NULL`
            }).pipe(Effect.orDie)),
        () =>
          Effect.sync(() => {
            const n = (held.get(k) ?? 1) - 1
            if (n <= 0) held.delete(k)
            else held.set(k, n)
          }),
      )
    }).pipe(Effect.withSpan("InboxService.handOverAnswers"))

  const take = Effect.fn("InboxService.take")(function* (query: { readonly unreadOnly?: boolean }) {
    const caller = yield* Caller
    const sessionId = caller.sessionId
    if (sessionId === null) return { session: null, items: [], earlier: [], claimed: [], human: human.name }
    const [session] = yield* sessions.byIds([sessionId])
    const now = yield* Clock.currentTimeMillis
    return yield* sql.withTransaction(Effect.gen(function* () {
      const earlier = query.unreadOnly ? [] : inOrder([
        ...yield* selectInboxItems(
          sql,
          sql`i.id IN (SELECT id FROM inbox_items WHERE session_id = ${sessionId} AND read_at IS NOT NULL
                       ORDER BY created_at DESC, rowid DESC LIMIT ${EARLIER})`,
        ),
        ...yield* selectReactionItems(
          sql,
          sql`r.id IN (SELECT id FROM comment_reactions WHERE notify_session_id = ${sessionId} AND read_at IS NOT NULL
                       ORDER BY created_at DESC, rowid DESC LIMIT ${EARLIER})`,
        ),
      ]).slice(-EARLIER)
      // One statement marks and claims them: whoever runs it first gets them, nobody else does. Answers a
      // live `cello wait` is about to hand over are left to it.
      const waitedOn = heldBy(sessionId)
      const taken = yield* sql<{ id: string }>`
        UPDATE inbox_items SET read_at = ${now} WHERE session_id = ${sessionId} AND read_at IS NULL
          AND ${waitedOn.length === 0 ? sql`1 = 1` : sql`(ask_id IS NULL OR ask_id NOT IN ${sql.in(waitedOn)})`}
        RETURNING id`
      const reacted = yield* sql<{ id: string }>`
        UPDATE comment_reactions SET read_at = ${now} WHERE notify_session_id = ${sessionId} AND read_at IS NULL RETURNING id`
      const items = inOrder([
        ...taken.length === 0 ? [] : yield* selectInboxItems(sql, sql.in("i.id", taken.map((r) => r.id))),
        ...reacted.length === 0 ? [] : yield* selectReactionItems(sql, sql.in("r.id", reacted.map((r) => r.id))),
      ])
      const held = yield* sql<{ project_key: string; number: number }>`
        SELECT p.key AS project_key, t.number FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.assignee_session_id = ${sessionId} AND t.archived_at IS NULL ORDER BY p.key, t.number`
      return { session: session ?? null, items, earlier, claimed: held.map((t) => formatTaskKey(t.project_key, t.number)), human: human.name }
    }))
  }, Effect.orDie)

  const wait = Effect.gen(function* () {
    // Joined before the first take: an item committed after that take publishes an event we get.
    const events = yield* log.live
    const first = yield* take({ unreadOnly: true })
    if (first.session === null || first.items.length > 0) return first
    // Each committed change may have delivered something; take again (a cheap update when it didn't).
    const next = yield* events.pipe(
      Stream.mapEffect(() => take({ unreadOnly: true })),
      Stream.filter((taken) => taken.items.length > 0),
      Stream.runHead,
    )
    return Option.getOrElse(next, () => first)
  }).pipe(Effect.scoped, Effect.withSpan("InboxService.wait"))

  const unread = Effect.gen(function* () {
    const caller = yield* Caller
    if (caller.sessionId === null) return []
    return inOrder([
      ...yield* selectInboxItems(sql, sql`i.session_id = ${caller.sessionId} AND i.read_at IS NULL`),
      ...yield* selectReactionItems(sql, sql`r.notify_session_id = ${caller.sessionId} AND r.read_at IS NULL`),
    ])
  }).pipe(Effect.orDie, Effect.withSpan("InboxService.unread"))

  return InboxService.of({
    take,
    wait,
    unread,
    deliverWithin,
    deliverAnswersWithin,
    deliverWithdrawalWithin,
    deliverReactionWithin,
    handOverAnswers,
  })
})

export const layer = Layer.effect(InboxService, make)
