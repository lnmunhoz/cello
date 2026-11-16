// Emoji reactions on comments (CEL-77). Additive only: one new table, nothing rebuilt or backfilled, so
// it's safe on a live board and doesn't care which migration runs before it.
//
// - One row per comment, emoji and reacting party: the human (no session) or an agent session. A
//   subagent's reaction is its session's. Removing a reaction deletes its row; the events keep it.
// - When Lucas reacts to an agent's comment, the reaction itself is that session's inbox item:
//   `notify_session_id` is who gets it and `read_at` that session's read mark (no event, as for
//   `inbox_items`). Removing the reaction before it's read takes the item back with the row.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE comment_reactions (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL REFERENCES comments(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    emoji TEXT NOT NULL,
    actor_id TEXT NOT NULL REFERENCES actors(id),
    session_id TEXT REFERENCES agent_sessions(id),
    agent_id TEXT,
    created_at INTEGER NOT NULL,
    notify_session_id TEXT REFERENCES agent_sessions(id),
    read_at INTEGER
  )`
  yield* sql`CREATE UNIQUE INDEX comment_reactions_one ON comment_reactions (comment_id, emoji, actor_id, COALESCE(session_id, ''))`
  yield* sql`CREATE INDEX comment_reactions_task ON comment_reactions (task_id)`
  yield* sql`CREATE INDEX comment_reactions_inbox ON comment_reactions (notify_session_id, created_at) WHERE notify_session_id IS NOT NULL`
})
