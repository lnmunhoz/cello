// Who changed a task last (CEL-5) and where it is inside In Progress (CEL-35). Additive only: three
// nullable columns, then "last changed" filled from each task's latest task event (the events_entity
// index makes that one lookup per task), or its creator when it has none. The stage list lives in
// @cello/contract/stages and the service checks it, so a new stage needs no migration.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE tasks ADD COLUMN stage TEXT`
  yield* sql`ALTER TABLE tasks ADD COLUMN updated_by_actor_id TEXT REFERENCES actors(id)`
  yield* sql`ALTER TABLE tasks ADD COLUMN updated_by_session_id TEXT REFERENCES agent_sessions(id)`

  yield* sql`UPDATE tasks SET
    updated_by_actor_id = COALESCE(
      (SELECT e.actor_id FROM events e WHERE e.entity_id = tasks.id AND e.entity_type = 'task' ORDER BY e.seq DESC LIMIT 1),
      created_by_actor_id),
    updated_by_session_id = CASE
      WHEN EXISTS (SELECT 1 FROM events e WHERE e.entity_id = tasks.id AND e.entity_type = 'task')
        THEN (SELECT e.session_id FROM events e WHERE e.entity_id = tasks.id AND e.entity_type = 'task' ORDER BY e.seq DESC LIMIT 1)
      ELSE created_by_session_id
    END`
})
