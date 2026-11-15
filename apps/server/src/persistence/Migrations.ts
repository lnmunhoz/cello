// Numbered migrations, run in order at startup and tracked in the `migrations` table.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import init from "./migrations/0001_init.ts"
import reviews from "./migrations/0002_reviews.ts"
import documents from "./migrations/0003_documents.ts"
import inbox from "./migrations/0004_inbox.ts"
import builds from "./migrations/0005_builds.ts"
import asks from "./migrations/0006_asks.ts"
import taskStage from "./migrations/0007_task_stage.ts"
import labelGroup from "./migrations/0009_label_group.ts"

// 0008 is CEL-43's (search). The migrator skips any id at or below the newest one already run, so
// 0009 must not reach a database before 0008 does.
export const migrations = SqliteMigrator.fromRecord({
  "0001_init": init,
  "0002_reviews": reviews,
  "0003_documents": documents,
  "0004_inbox": inbox,
  "0005_builds": builds,
  "0006_asks": asks,
  "0007_task_stage": taskStage,
  "0009_label_group": labelGroup,
})

/** Applies pending migrations. Failing to migrate is a defect: the server can't run on a half-built schema. */
export const run = SqliteMigrator.run({ loader: migrations, table: "migrations" }).pipe(
  Effect.orDie,
  Effect.withSpan("Migrations.run"),
)

export const layer = Layer.effectDiscard(run)
