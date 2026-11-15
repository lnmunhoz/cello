// Needs input (CEL-47): agents ask Lucas on the card and wait for his answers.
//
// - `statuses` gains the `waiting` category. SQLite can't change a CHECK in place, so the table is
//   rebuilt under the tasks that reference it: its rows are copied out, the table is dropped and made
//   again, and the rows go back with every column as it was. All migrations run in one transaction,
//   where foreign keys can't be switched off, so they're deferred to the commit instead: dropping the
//   table counts each task as dangling, and putting each status back counts its tasks as whole again.
//   If any task were left without its status, the commit would fail and nothing would change.
// - Every workspace without a Needs input status (by category, or one it named itself) gets one,
//   right before In Review. Existing statuses and tasks don't move.
// - `asks` holds the questions and Lucas's answers; `attachments.ask_id` links evidence and his pasted
//   screenshots to an ask, and `attachments.answer_to` his screenshots to what they answer.
// - `inbox_items` is rebuilt so an item holds a comment or an ask's answers (nothing references it).
import { needsInputNeighbors, NEEDS_INPUT_STATUS_NAME } from "@cello/shared/ask"
import { positionBetween } from "@cello/shared/position"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import { newId } from "../ids.ts"

/** Matches the defaults (status/defaults.ts). */
const NEEDS_INPUT_COLOR = "#EC4899"

const STATUS_COLUMNS = "id, workspace_id, name, category, position, color, hidden, created_at, updated_at"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const now = yield* Clock.currentTimeMillis

  yield* sql`PRAGMA defer_foreign_keys = ON`

  yield* sql.unsafe(`CREATE TABLE statuses_before_asks AS SELECT ${STATUS_COLUMNS} FROM statuses`)
  yield* sql`DROP TABLE statuses`
  yield* sql`CREATE TABLE statuses (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('backlog', 'unstarted', 'started', 'waiting', 'completed', 'canceled')),
    position TEXT NOT NULL,
    color TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (workspace_id, name)
  )`
  yield* sql.unsafe(`INSERT INTO statuses (${STATUS_COLUMNS}) SELECT ${STATUS_COLUMNS} FROM statuses_before_asks`)
  const [copied] = yield* sql<{ before: number; after: number }>`
    SELECT (SELECT COUNT(*) FROM statuses_before_asks) AS before, (SELECT COUNT(*) FROM statuses) AS after`
  if (copied!.before !== copied!.after) return yield* Effect.die(new Error(`statuses: copied ${copied!.after} of ${copied!.before} rows`))
  yield* sql`DROP TABLE statuses_before_asks`

  const workspaces = yield* sql<{ id: string }>`SELECT id FROM workspaces ORDER BY position, id`
  for (const { id: workspaceId } of workspaces) {
    const statuses = yield* sql<{ id: string; name: string; category: string; position: string }>`
      SELECT id, name, category, position FROM statuses WHERE workspace_id = ${workspaceId}`
    const has = statuses.some((s) => s.category === "waiting" || s.name.trim().toLowerCase() === NEEDS_INPUT_STATUS_NAME.toLowerCase())
    if (has) continue
    const { before, after } = needsInputNeighbors(statuses)
    const position = before !== null && after !== null && before >= after ? positionBetween(before, null) : positionBetween(before, after)
    yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, hidden, created_at, updated_at)
      VALUES (${newId(now)}, ${workspaceId}, ${NEEDS_INPUT_STATUS_NAME}, 'waiting', ${position}, ${NEEDS_INPUT_COLOR}, 0, ${now}, ${now})`
  }

  yield* sql`CREATE TABLE asks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    actor_id TEXT NOT NULL REFERENCES actors(id),
    session_id TEXT REFERENCES agent_sessions(id),
    title TEXT NOT NULL,
    intro TEXT NOT NULL DEFAULT '',
    questions TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'withdrawn', 'superseded')),
    created_at INTEGER NOT NULL,
    answered_at INTEGER,
    answers TEXT,
    note TEXT,
    withdrawn_at INTEGER,
    withdrawn_by TEXT REFERENCES actors(id)
  )`
  yield* sql`CREATE INDEX asks_task ON asks (task_id, created_at)`
  yield* sql`CREATE UNIQUE INDEX asks_one_open ON asks (task_id) WHERE state = 'open'`

  // Evidence has an ask_id only; a screenshot Lucas pasted also says what it answers: 'draft' until he
  // sends, then the question's id, or 'note' for the overall note.
  yield* sql`ALTER TABLE attachments ADD COLUMN ask_id TEXT REFERENCES asks(id)`
  yield* sql`ALTER TABLE attachments ADD COLUMN answer_to TEXT`
  yield* sql`CREATE INDEX attachments_ask ON attachments (ask_id)`

  yield* sql`CREATE TABLE inbox_items_next (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    comment_id TEXT REFERENCES comments(id),
    ask_id TEXT REFERENCES asks(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    kind TEXT NOT NULL CHECK (kind IN ('comment', 'send_back', 'answers')),
    created_at INTEGER NOT NULL,
    read_at INTEGER,
    CHECK ((comment_id IS NULL) <> (ask_id IS NULL)),
    UNIQUE (session_id, comment_id),
    UNIQUE (session_id, ask_id)
  )`
  yield* sql`INSERT INTO inbox_items_next (id, session_id, comment_id, task_id, kind, created_at, read_at)
    SELECT id, session_id, comment_id, task_id, kind, created_at, read_at FROM inbox_items ORDER BY rowid`
  yield* sql`DROP TABLE inbox_items`
  yield* sql`ALTER TABLE inbox_items_next RENAME TO inbox_items`
  yield* sql`CREATE INDEX inbox_items_session ON inbox_items (session_id, created_at)`
  yield* sql`CREATE INDEX inbox_items_unread ON inbox_items (session_id, created_at) WHERE read_at IS NULL`
})
