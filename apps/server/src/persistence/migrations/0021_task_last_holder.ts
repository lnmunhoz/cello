// A comment on a task nobody holds goes to the agent that last worked on it (CEL-110). Additive only:
// two nullable columns, so it's safe on a live board.
//
// - `tasks.last_holder_session_id`: the agent session that last held the task's claim. Every claim by
//   an agent session sets it, and it stays when the claim ends. Backfilled from the claim events
//   (`task.claimed`, `task.claim_taken`, which carry the whole task): the newest one whose task names an
//   agent session that still exists. A claim the human took names no session and is skipped, so the
//   agent before him counts. Tasks no agent ever claimed stay null.
// - `inbox_items.reopened_from`: for a comment that reopened its task for the session, the status the
//   task was in before (its `detail` is the status after, as for an ended claim). Null otherwise.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE tasks ADD COLUMN last_holder_session_id TEXT REFERENCES agent_sessions(id)`
  yield* sql`ALTER TABLE inbox_items ADD COLUMN reopened_from TEXT`
  yield* sql`
    UPDATE tasks SET last_holder_session_id = (
      SELECT json_extract(e.payload, '$.task.assigneeSessionId') FROM events e
      WHERE e.entity_id = tasks.id AND e.type IN ('task.claimed', 'task.claim_taken')
        AND json_extract(e.payload, '$.task.assigneeSessionId') IN (SELECT id FROM agent_sessions)
      ORDER BY e.seq DESC LIMIT 1
    )`
})
