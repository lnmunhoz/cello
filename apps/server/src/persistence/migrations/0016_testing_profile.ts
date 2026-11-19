// Testing profiles (CEL-89). Additive only: one new table, nothing existing rebuilt or backfilled, so
// it's safe on a live board.
//
// - `profile_fields` holds one row per field a project's testing profile has set: its value, who set
//   it last (`source`: detected by `cello init`, an agent, or the human; and the actor and session) and
//   when it was last set or confirmed. Field names are free text checked by the service
//   (@cello/domain/testingProfile), so a new field needs no migration. An unset field has no row.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE profile_fields (
    project_id TEXT NOT NULL REFERENCES projects(id),
    field TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('detected', 'agent', 'human')),
    actor_id TEXT NOT NULL REFERENCES actors(id),
    session_id TEXT REFERENCES agent_sessions(id),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, field)
  )`
})
