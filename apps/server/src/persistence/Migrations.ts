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
}

export const migrations = SqliteMigrator.fromRecord(records)

/** Applies pending migrations. Failing to migrate is a defect: the server can't run on a half-built schema. */
export const run = SqliteMigrator.run({ loader: migrations, table: "migrations" }).pipe(
  Effect.orDie,
  Effect.withSpan("Migrations.run"),
)

export const layer = Layer.effectDiscard(run)
