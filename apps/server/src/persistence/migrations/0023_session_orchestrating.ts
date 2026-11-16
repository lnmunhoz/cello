// Orchestrate mode (CEL-124). Additive only: one column on agent_sessions with a default, so it's safe on
// a live board. A session in it (`cello sessions orchestrate on`, which /cello:orchestrate runs) runs work
// through agents with nobody watching its window, so the Claude Code hook turns its AskUserQuestion away;
// `off` gives a chatting session the dialog back. Every session found starts out of it.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE agent_sessions ADD COLUMN orchestrating INTEGER NOT NULL DEFAULT 0`
})
