// Which model wrote it (CEL-119). Additive only: two nullable columns on four tables, so it's safe on a
// live board. Nothing is backfilled: what was written before shows no model rather than a guessed one.
//
// - `comments`, `events`: the model and effort the agent was on when it wrote the comment or made the
//   change, read from the end of its Claude Code transcript at that moment. Kept with the row, so a
//   session that switches model later (`/model`) leaves its older comments as they were.
// - `agent_sessions`, `session_agents`: its current model and effort, the last ones read for it (the
//   Agents page and the presence line show them).
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  for (const table of ["comments", "events", "agent_sessions", "session_agents"] as const) {
    yield* sql`ALTER TABLE ${sql(table)} ADD COLUMN model TEXT`
    yield* sql`ALTER TABLE ${sql(table)} ADD COLUMN effort TEXT`
  }
})
