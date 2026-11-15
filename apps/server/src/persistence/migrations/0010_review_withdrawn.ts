// A packet can be withdrawn (CEL-71): when its task leaves In Review by a plain move instead of a
// decision, the packet closes with `decision = 'withdrawn'`.
//
// - SQLite can't change a CHECK in place, so `reviews` is rebuilt under the attachments that reference
//   it, the way 0006 rebuilt `statuses`: its rows are copied out, the table is dropped and made again
//   with the wider CHECK, and the rows go back with every column as it was. All migrations run in one
//   transaction, where foreign keys can't be switched off, so they're deferred to the commit instead:
//   dropping the table counts each packet's evidence as dangling, putting each packet back counts it as
//   whole again. If any attachment were left without its packet, the commit would fail and nothing
//   would change.
// - Dropping the table drops its indexes and the search triggers 0008 put on it. The drop's implicit
//   delete fires no triggers, so the index keeps every packet's entry; the rows go back before the
//   triggers do, so none is indexed twice. Then both indexes and the triggers are made again, the same
//   as before.
// - No row changes: packets already left open on a task out of In Review stay open. Their task's next
//   move withdraws them, and the Review page lists only tasks in In Review.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import { sourceTriggers } from "./0008_search.ts"

const COLUMNS = "id, task_id, summary, steps, actor_id, session_id, created_at, decided_at, decision, decision_note"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`PRAGMA defer_foreign_keys = ON`

  yield* sql.unsafe(`CREATE TABLE reviews_before_withdrawn AS SELECT ${COLUMNS} FROM reviews`)
  yield* sql`DROP TABLE reviews`
  yield* sql`CREATE TABLE reviews (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    summary TEXT NOT NULL,
    steps TEXT NOT NULL,
    actor_id TEXT NOT NULL REFERENCES actors(id),
    session_id TEXT REFERENCES agent_sessions(id),
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    decision TEXT CHECK (decision IN ('approved', 'sent_back', 'superseded', 'withdrawn')),
    decision_note TEXT
  )`
  yield* sql.unsafe(`INSERT INTO reviews (${COLUMNS}) SELECT ${COLUMNS} FROM reviews_before_withdrawn ORDER BY rowid`)
  const [copied] = yield* sql<{ before: number; after: number }>`
    SELECT (SELECT COUNT(*) FROM reviews_before_withdrawn) AS before, (SELECT COUNT(*) FROM reviews) AS after`
  if (copied!.before !== copied!.after) return yield* Effect.die(new Error(`reviews: copied ${copied!.after} of ${copied!.before} rows`))
  yield* sql`DROP TABLE reviews_before_withdrawn`

  yield* sql`CREATE INDEX reviews_task ON reviews (task_id, created_at)`
  yield* sql`CREATE INDEX reviews_open ON reviews (task_id) WHERE decided_at IS NULL`
  for (const statement of sourceTriggers("reviews")) yield* sql.unsafe(statement)
})
