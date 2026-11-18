// A reviewer's verdict (CEL-160): `merge`, `fix_first` or `ask`, read from the start of its last reply when
// it finished, so a task's timeline can say how a review ended. Additive only: one nullable column, so it's
// safe on a live board. Nothing is backfilled: reviewers that finished before show no verdict.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE session_agents ADD COLUMN verdict TEXT`
})
