// A test run on a task's history (CEL-181). Test runs are an agent's presence (./activity.ts, ActivityService);
// this ties each to the task it was for, and writes `tests.finished` on that task when the run ends, in the
// same command that ends it. Plain functions over `sql`, not a service: ActivityService, AgentService and
// SessionService each end runs and all need them.
import * as Effect from "effect/Effect"
import type * as SqlClient from "effect/sql/SqlClient"
import type * as Commands from "../commands/Commands.ts"
import { endedNow, publicRun, type StoredTestRun } from "./activity.ts"

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

/** The task's place in the event log: its workspace and project. Null when the task isn't there. */
const placeOf = (sql: SqlClient.SqlClient, taskId: string) =>
  sql<{ workspace_id: string; project_id: string }>`
    SELECT p.workspace_id, p.id AS project_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ${taskId}`.pipe(
    Effect.map((rows) => rows[0] ?? null),
  )

/**
 * Keeps the runs a change just ended (CEL-181): for each run in `after` that was open in `before` (endedNow), a
 * `tests.finished` on its task, emitted in the caller's command so it commits with the run's end and is never
 * written twice (a run that's ended already isn't "ended now"). A run stored before the task was recorded
 * (`taskId` absent) gets its task now, from the actor's claims; one that had none at its start (null) gets
 * no event. Credited to `actor`'s agent, whoever is calling (a runner reports as its session). Returns
 * `after` with each such run's task filled in, to store in place of it.
 */
export const recordFinished = (
  sql: SqlClient.SqlClient,
  emit: Commands.WriteContext["emit"],
  before: ReadonlyArray<StoredTestRun>,
  after: ReadonlyArray<StoredTestRun>,
  actor: RunActor,
) =>
  Effect.gen(function* () {
    const resolved = new Map<string, StoredTestRun>()
    for (const run of endedNow(before, after)) {
      const taskId = run.taskId === undefined ? yield* runTask(sql, actor) : run.taskId
      const kept = { ...run, taskId }
      resolved.set(run.runId, kept)
      const place = taskId === null ? null : yield* placeOf(sql, taskId)
      if (taskId === null || place === null) continue
      yield* emit({ type: "tests.finished", taskId, run: publicRun(kept) }, { workspaceId: place.workspace_id, projectId: place.project_id, agentId: actor.agentId })
    }
    return after.map((run) => resolved.get(run.runId) ?? run)
  })
