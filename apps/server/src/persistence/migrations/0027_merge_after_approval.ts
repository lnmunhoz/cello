// Merge after I approve (CEL-143). In a project with the setting on, Approve keeps the agent's claim, marks
// the task Approved · merging and tells the agent's session to merge; the agent then finishes it with
// `cello task done`.
//
// - `projects.merge_after_approval`: the setting, 0 or 1. Every project already on the board keeps today's
//   behaviour (0: the agent merges before it submits, and Approve moves the task to Done); new projects
//   are switched on by ProjectService when they're made, not by this default.
// - `inbox_items` can say Lucas approved a task (`kind = 'approved'`): it holds neither a comment nor an
//   ask nor a cause; `detail` is his approval note, if he wrote one.
// - `session_runs.why` can be `approved`: Cello woke the session to merge an approved task.
//
// SQLite can't change a CHECK in place, so both tables are rebuilt as 0017 did: rows are copied with every
// column as it was, the old table is dropped and the new one renamed. Nothing references either table.
// Each copy is counted, and a short one fails the migration (and so the whole start) instead of losing rows.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

const INBOX_COLUMNS = "id, session_id, comment_id, ask_id, task_id, kind, detail, cause, reopened_from, created_at, read_at, read_via"
const RUN_COLUMNS =
  "id, session_id, task_id, task_ids, why, agent_kind, mode, cello_mode, pid, started_at, ended_at, exit_code, outcome, error, log_path"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  /** Copies `table` into `${table}_next`, checks the count, and puts the new table in its place. */
  const swap = (table: string, columns: string) =>
    Effect.gen(function* () {
      yield* sql.unsafe(`INSERT INTO ${table}_next (${columns}) SELECT ${columns} FROM ${table} ORDER BY rowid`)
      const [copied] = yield* sql.unsafe<{ before: number; after: number }>(
        `SELECT (SELECT COUNT(*) FROM ${table}) AS before, (SELECT COUNT(*) FROM ${table}_next) AS after`,
      )
      if (copied!.before !== copied!.after) return yield* Effect.die(new Error(`${table}: copied ${copied!.after} of ${copied!.before} rows`))
      yield* sql.unsafe(`DROP TABLE ${table}`)
      yield* sql.unsafe(`ALTER TABLE ${table}_next RENAME TO ${table}`)
    })

  yield* sql`ALTER TABLE projects ADD COLUMN merge_after_approval INTEGER NOT NULL DEFAULT 0`

  yield* sql`CREATE TABLE inbox_items_next (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    comment_id TEXT REFERENCES comments(id),
    ask_id TEXT REFERENCES asks(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    kind TEXT NOT NULL CHECK (kind IN ('comment', 'send_back', 'answers', 'withdrawn', 'claim_ended', 'approved')),
    detail TEXT,
    cause TEXT CHECK (cause IN ('moved', 'approved', 'edited', 'labels', 'archived', 'claimed', 'released')),
    reopened_from TEXT,
    created_at INTEGER NOT NULL,
    read_at INTEGER,
    read_via TEXT CHECK (read_via IN ('hook', 'inbox', 'wait')),
    CHECK (CASE kind
      WHEN 'claim_ended' THEN comment_id IS NULL AND ask_id IS NULL AND cause IS NOT NULL
      WHEN 'approved' THEN comment_id IS NULL AND ask_id IS NULL AND cause IS NULL
      ELSE (comment_id IS NULL) <> (ask_id IS NULL) AND cause IS NULL
    END),
    UNIQUE (session_id, comment_id),
    UNIQUE (session_id, ask_id)
  )`
  yield* swap("inbox_items", INBOX_COLUMNS)
  yield* sql`CREATE INDEX inbox_items_session ON inbox_items (session_id, created_at)`
  yield* sql`CREATE INDEX inbox_items_unread ON inbox_items (session_id, created_at) WHERE read_at IS NULL`

  yield* sql`CREATE TABLE session_runs_next (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    task_id TEXT REFERENCES tasks(id),
    task_ids TEXT NOT NULL DEFAULT '[]',
    why TEXT NOT NULL CHECK (why IN ('comment', 'answers', 'send_back', 'reaction', 'approved', 'manual')),
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
  yield* swap("session_runs", RUN_COLUMNS)
  yield* sql`CREATE INDEX session_runs_session ON session_runs (session_id, started_at)`
  yield* sql`CREATE INDEX session_runs_task ON session_runs (task_id, started_at)`
})
