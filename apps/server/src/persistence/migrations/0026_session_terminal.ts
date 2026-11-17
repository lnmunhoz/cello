// Where a session runs (CEL-137): the terminal app it was started in, from TERM_PROGRAM (`WezTerm`,
// `iTerm.app`, `vscode`), next to the entrypoint it already has. Additive only: one nullable column, so
// it's safe on a live board. Nothing is backfilled: sessions seen before show no terminal app.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE agent_sessions ADD COLUMN terminal TEXT`
})
