// A task's open ask, read and closed inside a running command. AskService uses these, and so does
// TaskService: a task leaving Needs input any other way (Lucas dragging the card) withdraws its ask,
// so an open ask and the Needs input column always go together.
import type { Ask } from "@cello/contract/entities"
import type { AskWithdrawReason } from "@cello/contract/events"
import * as Effect from "effect/Effect"
import type * as SqlClient from "effect/sql/SqlClient"
import type * as Commands from "../commands/Commands.ts"
import { selectAsks } from "../persistence/rows.ts"

/** The task's open ask, or null. */
export const openAskOf = (sql: SqlClient.SqlClient, taskId: string) =>
  selectAsks(sql, sql`a.task_id = ${taskId} AND a.state = 'open'`).pipe(Effect.map((rows): Ask | null => rows.at(-1) ?? null))

/**
 * Withdraws the task's open ask, if any, in the running command: `superseded` when a newer ask
 * replaces it, `withdrawn` otherwise. Returns the closed ask, or null when there was none.
 */
export const withdrawOpenAsk = (
  sql: SqlClient.SqlClient,
  context: Commands.WriteContext,
  task: { readonly id: string; readonly projectId: string },
  where: { readonly workspaceId: string; readonly projectId: string },
  reason: AskWithdrawReason,
) =>
  Effect.gen(function* () {
    const open = yield* openAskOf(sql, task.id)
    if (open === null) return null
    const state = reason === "superseded" ? "superseded" : "withdrawn"
    yield* sql`UPDATE asks SET state = ${state}, withdrawn_at = ${context.now}, withdrawn_by = ${context.caller.actorId} WHERE id = ${open.id}`
    yield* context.emit({ type: "ask.withdrawn", id: open.id, taskId: task.id, reason }, where)
    return { ...open, state, withdrawnAt: context.now, withdrawnBy: context.caller.actorId } satisfies Ask
  })
