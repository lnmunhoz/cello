// The stage `designing` is now `planning` (CEL-105): Lucas found "designing" read as UI design. It ran on
// the live board for a while, so a task may still hold it; this renames it in place. Events keep what they
// recorded: @cello/contract/stages reads a stored `designing` as `planning` when it decodes them.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`UPDATE tasks SET stage = 'planning' WHERE stage = 'designing'`
})
