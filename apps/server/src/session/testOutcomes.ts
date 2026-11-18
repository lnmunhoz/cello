// A test run on a task's history (CEL-181). Test runs are an agent's presence (./activity.ts, ActivityService);
// this ties each to the task it was for, and writes `tests.finished` on that task when the run ends, in the
// same command that ends it. Plain functions over `sql`, not a service: ActivityService, AgentService and
// SessionService each end runs and all need them.
import * as Effect from "effect/Effect"
import type * as SqlClient from "effect/sql/SqlClient"

/** Whose runs: the session's own (`agentId` null), or one of its subagents'. */
export interface RunActor {
  readonly sessionId: string
  readonly agentId: string | null
}

interface ClaimedTask {
  readonly id: string
}

/**
 * The task a run that starts now is for (CEL-181), or null:
 * 1. A subagent launched on a task (`session_agents.task_id`) runs for it.
 * 2. Else the session's claims on tasks that aren't archived: the only one, or of several the one the
 *    session itself touched last: the newest of its own task events and its own comments (a subagent's and
 *    Lucas's don't count, and neither does a test run written on the task).
 * 3. No claim: no task.
 * An archived task is never picked.
 */
export const runTask = (sql: SqlClient.SqlClient, actor: RunActor) =>
  Effect.gen(function* () {
    if (actor.agentId !== null) {
      const launched = yield* sql<{ id: string }>`
        SELECT t.id FROM session_agents a JOIN tasks t ON t.id = a.task_id
        WHERE a.session_id = ${actor.sessionId} AND a.agent_id = ${actor.agentId} AND t.archived_at IS NULL`
      if (launched[0]) return launched[0].id
    }
    const claims = yield* sql<ClaimedTask>`
      SELECT id FROM tasks WHERE assignee_session_id = ${actor.sessionId} AND archived_at IS NULL`
    if (claims.length <= 1) return claims[0]?.id ?? null
    const ids = claims.map((c) => c.id)
    const events = yield* sql<{ id: string; at: number }>`
      SELECT entity_id AS id, MAX(ts) AS at FROM events
      WHERE ${sql.in("entity_id", ids)} AND session_id = ${actor.sessionId} AND agent_id IS NULL AND type LIKE 'task.%'
      GROUP BY entity_id`
    const comments = yield* sql<{ id: string; at: number }>`
      SELECT task_id AS id, MAX(created_at) AS at FROM comments
      WHERE ${sql.in("task_id", ids)} AND session_id = ${actor.sessionId} AND agent_id IS NULL AND deleted_at IS NULL
      GROUP BY task_id`
    const last = new Map<string, number>()
    for (const row of [...events, ...comments]) last.set(row.id, Math.max(last.get(row.id) ?? 0, row.at))
    // Ties (two touches in one millisecond) go to the later id, which is the same every time.
    const [picked] = [...ids].sort((x, y) => (last.get(y) ?? 0) - (last.get(x) ?? 0) || (y < x ? -1 : y > x ? 1 : 0))
    return picked ?? null
  })
