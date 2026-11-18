// An approval passed on from chat (CEL-169): the agent session that relayed the human's "Approved, commit"
// to the card, kept on the review it closed so the card, Reviews and `cello task get` can say so. Additive
// only: one nullable column that points at an existing agent session, so it's safe on a live board.
// Nothing is backfilled: approvals decided before were all the human's own.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE reviews ADD COLUMN relayed_session_id TEXT REFERENCES agent_sessions(id)`
})
