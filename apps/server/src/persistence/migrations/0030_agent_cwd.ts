// A subagent's own folder (CEL-152): where its last `cello` call ran, so the Agents page shows a builder's
// worktree and not whichever agent of the session called last. Additive only: one nullable column, so it's
// safe on a live board. Nothing is backfilled: agents seen before show their session's folder, as they did.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE session_agents ADD COLUMN cwd TEXT`
})
