// Numbered migrations, run in order at startup and tracked in the `migrations` table. A database with a
// migration this build doesn't know was opened by a newer Cello (CEL-149): it's refused before anything
// runs, so an older download never writes to a board a newer build already migrated.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { APP_VERSION } from "@cello/shared/version"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/sql/SqlClient"
import init from "./migrations/0001_init.ts"
import reviews from "./migrations/0002_reviews.ts"
import documents from "./migrations/0003_documents.ts"
import inbox from "./migrations/0004_inbox.ts"
import builds from "./migrations/0005_builds.ts"
import asks from "./migrations/0006_asks.ts"
import taskStage from "./migrations/0007_task_stage.ts"
import search from "./migrations/0008_search.ts"
import labelGroup from "./migrations/0009_label_group.ts"
import reviewWithdrawn from "./migrations/0010_review_withdrawn.ts"
import agents from "./migrations/0011_agents.ts"
import commentAttachments from "./migrations/0012_comment_attachments.ts"
import reactions from "./migrations/0013_reactions.ts"
import inboxReadVia from "./migrations/0014_inbox_read_via.ts"
import projectLabels from "./migrations/0015_project_labels.ts"
import testingProfile from "./migrations/0016_testing_profile.ts"
import inboxClaimEnded from "./migrations/0017_inbox_claim_ended.ts"
import sessionWake from "./migrations/0018_session_wake.ts"
import agentLogs from "./migrations/0019_agent_logs.ts"
import stagePlanning from "./migrations/0020_stage_planning.ts"
import taskLastHolder from "./migrations/0021_task_last_holder.ts"
import writerModel from "./migrations/0022_writer_model.ts"
import sessionOrchestrating from "./migrations/0023_session_orchestrating.ts"
import milestones from "./migrations/0024_milestones.ts"
import agentActivity from "./migrations/0025_agent_activity.ts"
import sessionTerminal from "./migrations/0026_session_terminal.ts"
import mergeAfterApproval from "./migrations/0027_merge_after_approval.ts"

/** Every migration by id. Tests of one migration run the ones before it from here. */
export const records = {
  "0001_init": init,
  "0002_reviews": reviews,
  "0003_documents": documents,
  "0004_inbox": inbox,
  "0005_builds": builds,
  "0006_asks": asks,
  "0007_task_stage": taskStage,
  "0008_search": search,
  "0009_label_group": labelGroup,
  "0010_review_withdrawn": reviewWithdrawn,
  "0011_agents": agents,
  "0012_comment_attachments": commentAttachments,
  "0013_reactions": reactions,
  "0014_inbox_read_via": inboxReadVia,
  "0015_project_labels": projectLabels,
  "0016_testing_profile": testingProfile,
  "0017_inbox_claim_ended": inboxClaimEnded,
  "0018_session_wake": sessionWake,
  "0019_agent_logs": agentLogs,
  "0020_stage_planning": stagePlanning,
  "0021_task_last_holder": taskLastHolder,
  "0022_writer_model": writerModel,
  "0023_session_orchestrating": sessionOrchestrating,
  "0024_milestones": milestones,
  "0025_agent_activity": agentActivity,
  "0026_session_terminal": sessionTerminal,
  "0027_merge_after_approval": mergeAfterApproval,
}

export const migrations = SqliteMigrator.fromRecord(records)

/** "0027_merge_after_approval": a migration as its file and the `records` key name it. */
const label = (id: number, name: string): string => `${String(id).padStart(4, "0")}_${name}`

/**
 * The database has a migration this build doesn't know: a newer Cello opened it (CEL-149). Nothing was
 * run or written. `dataDir` is the board's folder when the server knows it (server.ts adds it).
 */
export class BoardTooNew extends Schema.TaggedError<BoardTooNew>()("BoardTooNew", {
  /** The newest migration it has that this build doesn't know, e.g. "0028_inbox_rules". */
  newest: Schema.String,
  /** The newest migration this build knows. */
  known: Schema.String,
  /** This build's version. */
  version: Schema.String,
  dataDir: Schema.NullOr(Schema.String),
}) {
  override get message(): string {
    const board = this.dataDir === null ? "This board" : `This board (${this.dataDir})`
    return `${board} was opened by a newer Cello (migration ${this.newest}); this cello is v${this.version}. ` +
      "Update Cello, or use another board. Nothing was changed."
  }
}

/** Fails with BoardTooNew when the database has a migration this build doesn't have. Only reads. */
const refuseNewer = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const known = yield* migrations
  const tracked = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'migrations'`
  if ((tracked[0]?.n ?? 0) === 0) return
  const applied = yield* sql<{ migration_id: number; name: string }>`SELECT migration_id, name FROM migrations ORDER BY migration_id`
  const ids = new Set(known.map(([id]) => id))
  const newest = applied.filter((row) => !ids.has(row.migration_id)).at(-1)
  if (!newest) return
  const [knownId, knownName] = known.at(-1) ?? [0, "none"]
  return yield* new BoardTooNew({ newest: label(newest.migration_id, newest.name), known: label(knownId, knownName), version: APP_VERSION, dataDir: null })
})

/**
 * Refuses a database a newer Cello migrated (BoardTooNew), then applies the pending migrations. Failing to
 * read or migrate is a defect: the server can't run on a half-built schema.
 */
export const run: Effect.Effect<void, BoardTooNew, SqlClient.SqlClient> = Effect.gen(function* () {
  yield* refuseNewer.pipe(Effect.catchTag(["SqlError", "MigrationError"], (error) => Effect.die(error)))
  yield* SqliteMigrator.run({ loader: migrations, table: "migrations" }).pipe(Effect.orDie)
}).pipe(Effect.withSpan("Migrations.run"))

export const layer = Layer.effectDiscard(run)

/** The server's: `layer`, its refusal naming the board's folder. */
export const layerFor = (dataDir: string) =>
  Layer.effectDiscard(run.pipe(Effect.mapError((error) =>
    new BoardTooNew({ newest: error.newest, known: error.known, version: error.version, dataDir }))))
