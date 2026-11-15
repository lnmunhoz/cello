// Build history (CEL-50): one row per build a server has run, written once when a server first starts
// on it (BuildHistory.record). A restart of the same build moves only `last_started_at`. Additive: a new
// table (its UNIQUE number is the index pages are read by); nothing existing changes. IF NOT EXISTS, so
// running it on a database that already has the table changes nothing.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE IF NOT EXISTS builds (
    id TEXT PRIMARY KEY,
    number INTEGER NOT NULL UNIQUE,
    version TEXT NOT NULL,
    commit_hash TEXT,
    web_built_at INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    last_started_at INTEGER NOT NULL,
    changes TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`
})
