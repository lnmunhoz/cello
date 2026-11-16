// What an agent is doing besides its last tool call (CEL-133, CEL-134). Additive only: nullable JSON
// columns on sessions and subagents, so it's safe on a live board. Nothing is backfilled: they fill in
// from the next hook that reports them.
//
// - `background_json` (both): the background work the agent started itself and Claude Code may still be
//   running, `[{ id, label, toolUseId }]`, from PostToolUse (a shell run with run_in_background, a
//   Monitor). A stop compares it with Claude Code's `background_tasks`.
// - `waiting_json` (subagents): what a subagent that ended its turn is still waiting on, `["Bash · …"]`;
//   it isn't finished until a stop with none of its work left (CEL-133).
// - `tests_json` (both): its test run, the one running or the last one, with its progress (CEL-134).
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  for (const table of ["agent_sessions", "session_agents"] as const) {
    yield* sql`ALTER TABLE ${sql(table)} ADD COLUMN background_json TEXT`
    yield* sql`ALTER TABLE ${sql(table)} ADD COLUMN tests_json TEXT`
  }
  yield* sql`ALTER TABLE session_agents ADD COLUMN waiting_json TEXT`
})
