// Numbered migrations, run in order at startup and tracked in the `migrations` table.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import init from "./migrations/0001_init.ts"
import reviews from "./migrations/0002_reviews.ts"
import documents from "./migrations/0003_documents.ts"
import inbox from "./migrations/0004_inbox.ts"
import taskStage from "./migrations/0007_task_stage.ts"

export const migrations = SqliteMigrator.fromRecord({
  "0001_init": init,
  "0002_reviews": reviews,
  "0003_documents": documents,
  "0004_inbox": inbox,
  // 0005 and 0006 belong to CEL-50 (builds) and CEL-47 (asks), landing first.
  "0007_task_stage": taskStage,
})

/** Applies pending migrations. Failing to migrate is a defect: the server can't run on a half-built schema. */
export const run = SqliteMigrator.run({ loader: migrations, table: "migrations" }).pipe(
  Effect.orDie,
  Effect.withSpan("Migrations.run"),
)

export const layer = Layer.effectDiscard(run)
