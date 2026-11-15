// Agent inboxes (CEL-15): a human comment is delivered, in the comment's own transaction, to the agent
// session holding the task's claim. `read_at` is that session's read mark; it isn't board state, so
// changing it writes no event.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE inbox_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    comment_id TEXT NOT NULL REFERENCES comments(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    kind TEXT NOT NULL CHECK (kind IN ('comment', 'send_back')),
    created_at INTEGER NOT NULL,
    read_at INTEGER,
    UNIQUE (session_id, comment_id)
  )`
  yield* sql`CREATE INDEX inbox_items_session ON inbox_items (session_id, created_at)`
  yield* sql`CREATE INDEX inbox_items_unread ON inbox_items (session_id, created_at) WHERE read_at IS NULL`
})
