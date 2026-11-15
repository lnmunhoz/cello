// Agent inboxes (CEL-15). A human comment on a task is delivered, inside the comment's command, to the
// agent session holding the task's claim at that moment. A Send back note goes the same way, and when
// a human change ended the claim during review, to the session that submitted the packet. Agents'
// comments (their own or another session's) are never delivered, and nothing reaches a session after
// its claim ends. Reading marks items read for that session only; marks aren't board state, so they
// write no events (like a session's `last_seen_at`).
import type { Comment, InboxKind } from "@cello/contract/entities"
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

/** How many read items the full list shows after the new ones. */
export const EARLIER = 10

export class InboxService extends Context.Service<InboxService, {
  /** The caller's inbox: new items, plus the latest read ones unless `unreadOnly`. Empty for the human. */
  readonly list: (query: { readonly unreadOnly?: boolean }) => Effect.Effect<Inbox, never, Caller>
  /** Marks the caller's items read; others' items and ones already read are left alone. */
  readonly markRead: (ids: ReadonlyArray<string>) => Effect.Effect<{ readonly marked: number }, never, Caller>
  /**
   * For the command that adds a comment: delivers it, in that command's transaction, to whoever should
   * get it (see the top of this file). `send_back` is a review's note, added by the same command.
   */
  readonly deliverWithin: (context: Commands.WriteContext, comment: Comment, kind: InboxKind) => Effect.Effect<void, SqlError>
}>()("cello/InboxService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const sessions = yield* SessionService

  /** Who gets a human comment: the task's claim holder, else for a Send back the packet's submitter. */
  const recipientOf = (context: Commands.WriteContext, comment: Comment, kind: InboxKind) =>
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

  const deliverWithin = (context: Commands.WriteContext, comment: Comment, kind: InboxKind) =>
    Effect.gen(function* () {
      if (context.caller.sessionId !== null) return
      const sessionId = yield* recipientOf(context, comment, kind)
      if (sessionId === null) return
      yield* sql`INSERT INTO inbox_items (id, session_id, comment_id, task_id, kind, created_at)
        VALUES (${newId(context.now)}, ${sessionId}, ${comment.id}, ${comment.taskId}, ${kind}, ${comment.createdAt})
        ON CONFLICT (session_id, comment_id) DO NOTHING`
    }).pipe(Effect.withSpan("InboxService.deliverWithin"))

  const list = Effect.fn("InboxService.list")(function* (query: { readonly unreadOnly?: boolean }) {
    const caller = yield* Caller
    if (caller.sessionId === null) return { session: null, items: [], unread: 0 }
    const [session] = yield* sessions.byIds([caller.sessionId])
    const unread = yield* selectInboxItems(sql, sql`i.session_id = ${caller.sessionId} AND i.read_at IS NULL`)
    const earlier = query.unreadOnly
      ? []
      : yield* selectInboxItems(
        sql,
        sql`i.id IN (SELECT id FROM inbox_items WHERE session_id = ${caller.sessionId} AND read_at IS NOT NULL
                     ORDER BY created_at DESC, rowid DESC LIMIT ${EARLIER})`,
      )
    const items = [...earlier, ...unread].sort((a, b) => a.createdAt - b.createdAt)
    return { session: session ?? null, items, unread: unread.length }
  }, Effect.orDie)

  const markRead = Effect.fn("InboxService.markRead")(function* (ids: ReadonlyArray<string>) {
    const caller = yield* Caller
    if (caller.sessionId === null || ids.length === 0) return { marked: 0 }
    const now = yield* Clock.currentTimeMillis
    const rows = yield* sql<{ id: string }>`
      UPDATE inbox_items SET read_at = ${now}
      WHERE session_id = ${caller.sessionId} AND read_at IS NULL AND ${sql.in("id", [...new Set(ids)])}
      RETURNING id`
    return { marked: rows.length }
  }, Effect.orDie)

  return InboxService.of({ list, markRead, deliverWithin })
})

export const layer = Layer.effect(InboxService, make)
