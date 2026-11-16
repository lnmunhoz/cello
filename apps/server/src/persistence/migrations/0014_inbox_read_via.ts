// Comment receipts (CEL-76). Additive only: one nullable column on inbox_items, null on every row there
// is, nothing rebuilt or backfilled, so it's safe on a live board.
//
// - `read_via` says how the session took the item, set with `read_at`: its hook (PostToolUse or Stop),
//   `cello inbox`, or `cello inbox --wait`. Taking a comment now also writes a `comment.delivered` event,
//   so Lucas sees the receipt; the column is what `comment.list` reads it back from.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE inbox_items ADD COLUMN read_via TEXT CHECK (read_via IN ('hook', 'inbox', 'wait'))`
})
