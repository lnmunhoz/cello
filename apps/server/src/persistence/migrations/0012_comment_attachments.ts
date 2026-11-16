// Screenshots in comments (CEL-73). Additive only: a nullable `comment_id` on attachments and its index.
// Every row there is reads null (evidence, an ask's files, Lucas's answer screenshots); nothing is
// backfilled or rebuilt, so it's safe on a live board.
//
// A screenshot Lucas pastes into a comment box is uploaded while he writes, as a draft of the task:
// `answer_to = 'draft'` with no ask, review or comment. Sending the comment sets `comment_id` and clears
// `answer_to`; an image an agent attaches (`cello task comment --attach`) is stored with its comment at once.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE attachments ADD COLUMN comment_id TEXT REFERENCES comments(id)`
  yield* sql`CREATE INDEX attachments_comment ON attachments (comment_id)`
})
