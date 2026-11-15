// A task's open review packet, read and closed inside a running command. ReviewService uses these, and
// so does TaskService: a task leaving In Review any other way than a decision (an agent's plain
// `cello task move`, Lucas dragging the card) withdraws its packet (CEL-71), so an open packet always
// belongs to a task that is waiting on Lucas.
import type { Review } from "@cello/contract/entities"
import * as Effect from "effect/Effect"
import type * as SqlClient from "effect/sql/SqlClient"
import type * as Commands from "../commands/Commands.ts"
import { selectReviews } from "../persistence/rows.ts"

/** The task's open review, or null. */
export const openReviewOf = (sql: SqlClient.SqlClient, taskId: string) =>
  selectReviews(sql, sql`r.task_id = ${taskId} AND r.decided_at IS NULL`).pipe(Effect.map((rows): Review | null => rows.at(-1) ?? null))

/**
 * Withdraws the task's open review, if any, in the running command: the task is being moved to the
 * status `to`. Returns the closed review, or null when there was none.
 */
export const withdrawOpenReview = (
  sql: SqlClient.SqlClient,
  context: Commands.WriteContext,
  task: { readonly id: string },
  where: { readonly workspaceId: string; readonly projectId: string },
  to: string,
) =>
  Effect.gen(function* () {
    const open = yield* openReviewOf(sql, task.id)
    if (open === null) return null
    yield* sql`UPDATE reviews SET decided_at = ${context.now}, decision = 'withdrawn' WHERE id = ${open.id}`
    yield* context.emit({ type: "review.withdrawn", id: open.id, taskId: task.id, to }, where)
    return { ...open, decidedAt: context.now, decision: "withdrawn" } satisfies Review
  })
