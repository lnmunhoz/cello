// Subagents under an agent session (CEL-55). Additive only: a new table keyed by the session and the
// host's agent id, and a nullable agent column on events, comments and tasks' "last changed". Rows that
// were there before read as the session itself (null); nothing is backfilled or rebuilt, so it's safe
// on a live board. Claims and inbox delivery keep using agent_sessions: an agent is never a holder.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE session_agents (
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    agent_id TEXT NOT NULL,
    agent_type TEXT,
    task_id TEXT REFERENCES tasks(id),
    description TEXT,
    started_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    ended_at INTEGER,
    PRIMARY KEY (session_id, agent_id)
  )`
  yield* sql`CREATE INDEX session_agents_task ON session_agents (task_id, last_seen_at)`
  yield* sql`CREATE INDEX session_agents_seen ON session_agents (last_seen_at)`

  yield* sql`ALTER TABLE events ADD COLUMN agent_id TEXT`
  yield* sql`ALTER TABLE comments ADD COLUMN agent_id TEXT`
  yield* sql`ALTER TABLE tasks ADD COLUMN updated_by_agent_id TEXT`
})
