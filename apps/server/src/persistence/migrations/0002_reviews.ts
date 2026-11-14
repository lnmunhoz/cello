// Review packets and the evidence attached to them (CEL-10). Files live in <dataDir>/assets/; rows
// keep paths relative to that folder.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE reviews (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    summary TEXT NOT NULL,
    steps TEXT NOT NULL,
    actor_id TEXT NOT NULL REFERENCES actors(id),
    session_id TEXT REFERENCES agent_sessions(id),
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    decision TEXT CHECK (decision IN ('approved', 'sent_back', 'superseded')),
    decision_note TEXT
  )`
  yield* sql`CREATE INDEX reviews_task ON reviews (task_id, created_at)`
  yield* sql`CREATE INDEX reviews_open ON reviews (task_id) WHERE decided_at IS NULL`

  yield* sql`CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    review_id TEXT REFERENCES reviews(id),
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'file', 'link')),
    name TEXT NOT NULL,
    path TEXT,
    url TEXT,
    caption TEXT NOT NULL DEFAULT '',
    mime TEXT,
    bytes INTEGER,
    poster_path TEXT,
    actor_id TEXT NOT NULL REFERENCES actors(id),
    session_id TEXT REFERENCES agent_sessions(id),
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`
  yield* sql`CREATE INDEX attachments_task ON attachments (task_id, created_at)`
  yield* sql`CREATE INDEX attachments_review ON attachments (review_id)`
})
