// An agent's live log (CEL-106). Additive only: three nullable columns on sessions and on subagents, so
// it's safe on a live board. Nothing is backfilled: they fill in from the next hook that reports them.
//
// - `transcript_path`: the Claude Code transcript a hook last reported for it (the session's own file,
//   or the subagent's under `<session>/subagents/`). Only a path; the log is read from it on demand
//   and never copied into Cello, so backups don't grow.
// - `current_step`, `current_step_at`: its last tool call in one line ("Bash · bun run test") and when,
//   from the PostToolUse hook, keys masked.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  for (const table of ["agent_sessions", "session_agents"] as const) {
    yield* sql`ALTER TABLE ${sql(table)} ADD COLUMN transcript_path TEXT`
    yield* sql`ALTER TABLE ${sql(table)} ADD COLUMN current_step TEXT`
    yield* sql`ALTER TABLE ${sql(table)} ADD COLUMN current_step_at INTEGER`
  }
})
