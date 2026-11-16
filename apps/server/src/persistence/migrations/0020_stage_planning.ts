// The stage `designing` is now `planning` (CEL-105): Lucas found "designing" read as UI design. It ran on
// the live board for a while, so a task may still hold it; this renames it in place. Command receipts too:
// a retry of a command hands back its stored result as it was (Commands), and a result saying `designing`
// would no longer encode as a response. Commands stores JSON.stringify output, so a stage reads exactly
// `"stage":"designing"`, a task's own or a task copy's inside a result; the same words inside a string
// (a title) have escaped quotes and don't match. Events keep what they recorded: @cello/contract/stages
// reads a stored `designing` as `planning` when it decodes them.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`UPDATE tasks SET stage = 'planning' WHERE stage = 'designing'`
  yield* sql`UPDATE command_receipts SET result = replace(result, '"stage":"designing"', '"stage":"planning"')
    WHERE result LIKE '%"stage":"designing"%'`
})
