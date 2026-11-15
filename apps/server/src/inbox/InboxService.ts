// Agent inboxes (CEL-15). A human comment on a task is delivered, inside the comment's command, to the
// agent session holding the task's claim at that moment. A Send back note goes the same way, and when
// a human change ended the claim during review, to the session that submitted the packet. Lucas's
// answers to an ask (CEL-47) go to the claim holder too, else to the session that asked. Agents'
// comments (their own or another session's) are never delivered, and nothing reaches a session after
// its claim ends. `take` hands the new items over and marks them read in one statement, so each item
// reaches the session once, even when several hooks ask at the same time. Read marks belong to the
// session, not the board, so they write no events (like a session's `last_seen_at`).
import type { Ask, Comment, InboxItem } from "@cello/contract/entities"
import { Caller } from "@cello/contract/rpcs"
import type { Inbox } from "@cello/contract/views"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import type * as Commands from "../commands/Commands.ts"
import { newId } from "../persistence/ids.ts"
import { selectInboxItems } from "../persistence/rows.ts"
import { SessionService } from "../session/SessionService.ts"

/** How many items read before `take` returns as `earlier`. */
export const EARLIER = 10

export class InboxService extends Context.Service<InboxService, {
  /**
   * Hands the caller its new items and marks them read, atomically: a second take, even a concurrent
   * one, never gets the same item. Also returns the latest read ones unless `unreadOnly`. Empty for the human.
   */
  readonly take: (query: { readonly unreadOnly?: boolean }) => Effect.Effect<Inbox, never, Caller>
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
  /** Marks the caller's item for an ask's answers read: `cello wait` handed them over, so the hook won't. */
  readonly markAnswersRead: (askId: string) => Effect.Effect<void, never, Caller>
}>()("cello/InboxService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const sessions = yield* SessionService

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

  const markAnswersRead = (askId: string) =>
    Effect.gen(function* () {
      const caller = yield* Caller
      if (caller.sessionId === null) return
      const now = yield* Clock.currentTimeMillis
      yield* sql`UPDATE inbox_items SET read_at = ${now} WHERE ask_id = ${askId} AND session_id = ${caller.sessionId} AND read_at IS NULL`
    }).pipe(Effect.orDie, Effect.withSpan("InboxService.markAnswersRead"))

  const take = Effect.fn("InboxService.take")(function* (query: { readonly unreadOnly?: boolean }) {
    const caller = yield* Caller
    const sessionId = caller.sessionId
    if (sessionId === null) return { session: null, items: [], earlier: [] }
    const [session] = yield* sessions.byIds([sessionId])
    const now = yield* Clock.currentTimeMillis
    return yield* sql.withTransaction(Effect.gen(function* () {
      const earlier = query.unreadOnly ? [] : yield* selectInboxItems(
        sql,
        sql`i.id IN (SELECT id FROM inbox_items WHERE session_id = ${sessionId} AND read_at IS NOT NULL
                     ORDER BY created_at DESC, rowid DESC LIMIT ${EARLIER})`,
      )
      // One statement marks and claims them: whoever runs it first gets them, nobody else does.
      const taken = yield* sql<{ id: string }>`
        UPDATE inbox_items SET read_at = ${now} WHERE session_id = ${sessionId} AND read_at IS NULL RETURNING id`
      const items = taken.length === 0 ? [] : yield* selectInboxItems(sql, sql.in("i.id", taken.map((r) => r.id)))
      return { session: session ?? null, items, earlier }
    }))
  }, Effect.orDie)

  const unread = Effect.gen(function* () {
    const caller = yield* Caller
    if (caller.sessionId === null) return []
    return yield* selectInboxItems(sql, sql`i.session_id = ${caller.sessionId} AND i.read_at IS NULL`)
  }).pipe(Effect.orDie, Effect.withSpan("InboxService.unread"))

  return InboxService.of({ take, unread, deliverWithin, deliverAnswersWithin, deliverWithdrawalWithin, markAnswersRead })
})

export const layer = Layer.effect(InboxService, make)
