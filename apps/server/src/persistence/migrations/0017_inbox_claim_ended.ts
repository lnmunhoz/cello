// Lucas ending a claim reaches the session (CEL-46): an inbox item can say that a change he made to a
// task ended the session's claim on it (`kind = 'claim_ended'`). Such an item holds neither a comment
// nor an ask; `detail` is the status the card is in after the change and the new `cause` says what he
// did (moved, approved, edited, labels, archived, claimed, released).
//
// SQLite can't change a CHECK in place, so `inbox_items` is rebuilt as 0006 did: its rows are copied
// into the new table with every column as it was, the old table is dropped and the new one renamed.
// Nothing references `inbox_items`. The copy is counted, and a short one fails the migration (and so
// the whole start) instead of losing items.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

const COLUMNS = "id, session_id, comment_id, ask_id, task_id, kind, detail, created_at, read_at, read_via"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE inbox_items_next (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    comment_id TEXT REFERENCES comments(id),
    ask_id TEXT REFERENCES asks(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    kind TEXT NOT NULL CHECK (kind IN ('comment', 'send_back', 'answers', 'withdrawn', 'claim_ended')),
    detail TEXT,
    cause TEXT CHECK (cause IN ('moved', 'approved', 'edited', 'labels', 'archived', 'claimed', 'released')),
    created_at INTEGER NOT NULL,
    read_at INTEGER,
    read_via TEXT CHECK (read_via IN ('hook', 'inbox', 'wait')),
    CHECK (CASE kind
      WHEN 'claim_ended' THEN comment_id IS NULL AND ask_id IS NULL AND cause IS NOT NULL
      ELSE (comment_id IS NULL) <> (ask_id IS NULL) AND cause IS NULL
    END),
    UNIQUE (session_id, comment_id),
    UNIQUE (session_id, ask_id)
  )`
  yield* sql.unsafe(`INSERT INTO inbox_items_next (${COLUMNS}) SELECT ${COLUMNS} FROM inbox_items ORDER BY rowid`)
  const [copied] = yield* sql<{ before: number; after: number }>`
    SELECT (SELECT COUNT(*) FROM inbox_items) AS before, (SELECT COUNT(*) FROM inbox_items_next) AS after`
  if (copied!.before !== copied!.after) return yield* Effect.die(new Error(`inbox_items: copied ${copied!.after} of ${copied!.before} rows`))
  yield* sql`DROP TABLE inbox_items`
  yield* sql`ALTER TABLE inbox_items_next RENAME TO inbox_items`
  yield* sql`CREATE INDEX inbox_items_session ON inbox_items (session_id, created_at)`
  yield* sql`CREATE INDEX inbox_items_unread ON inbox_items (session_id, created_at) WHERE read_at IS NULL`
})
