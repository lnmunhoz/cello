// Waking sessions (CEL-92). Additive only: two nullable columns, two new tables, and one backfill of the
// new `agent_kind` column, so it's safe on a live board.
//
// - `agent_sessions.permission_mode`: the session's permission mode as its host last reported it
//   (Claude Code's hooks send `permission_mode`); a woken run uses the same one. Null until a hook says.
// - `agent_sessions.agent_kind`: which agent CLI the session is (`claude-code`), so Cello knows which
//   adapter can continue it. Sessions Claude Code made before this (client "Claude Code") are filled in.
// - `session_runs`: one row per woken run: why, the mode it ran with, its process, how it ended. `task_id`
//   is the task whose action woke it; `task_ids` (a JSON array) every task the run was for, which each
//   count it toward their cap. Its log is a file under `<dataDir>/runs/<session>/`, which backups leave out.
// - `wake_settings`: a project's settings. No row means the defaults: off, 3 wakes per task per hour.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE agent_sessions ADD COLUMN permission_mode TEXT`
  yield* sql`ALTER TABLE agent_sessions ADD COLUMN agent_kind TEXT`
  yield* sql`UPDATE agent_sessions SET agent_kind = 'claude-code' WHERE client_name = 'Claude Code'`

  yield* sql`CREATE TABLE session_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    task_id TEXT REFERENCES tasks(id),
    task_ids TEXT NOT NULL DEFAULT '[]',
    why TEXT NOT NULL CHECK (why IN ('comment', 'answers', 'send_back', 'reaction', 'manual')),
    agent_kind TEXT NOT NULL,
    mode TEXT NOT NULL,
    cello_mode TEXT NOT NULL,
    pid INTEGER,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    exit_code INTEGER,
    outcome TEXT NOT NULL CHECK (outcome IN ('running', 'completed', 'failed', 'stopped')),
    error TEXT,
    log_path TEXT NOT NULL
  )`
  yield* sql`CREATE INDEX session_runs_session ON session_runs (session_id, started_at)`
  yield* sql`CREATE INDEX session_runs_task ON session_runs (task_id, started_at)`

  yield* sql`CREATE TABLE wake_settings (
    project_id TEXT PRIMARY KEY REFERENCES projects(id),
    enabled INTEGER NOT NULL DEFAULT 0,
    cap_per_hour INTEGER NOT NULL DEFAULT 3,
    updated_at INTEGER NOT NULL
  )`
})
