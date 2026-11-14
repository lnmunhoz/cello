// The one SQLite connection. Foreign keys are per connection, so they're switched on here.
import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"

const enableForeignKeys = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`PRAGMA foreign_keys = ON`
  }).pipe(Effect.orDie),
)

/** `filename` is a path, or ":memory:" for tests. Failing to open the database is a defect. */
export const layer = (filename: string) =>
  enableForeignKeys.pipe(Layer.provideMerge(SqliteClient.layer({ filename })), Layer.orDie)
