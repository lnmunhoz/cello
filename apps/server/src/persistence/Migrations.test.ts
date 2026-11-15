// Upgrading a database that already has review evidence: 0003 rebuilds `attachments` (a page's files
// hang off its document, not a task) and must keep every row.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "./Migrations.ts"
import init from "./migrations/0001_init.ts"
import reviews from "./migrations/0002_reviews.ts"
import documents from "./migrations/0003_documents.ts"
import inbox from "./migrations/0004_inbox.ts"
import * as Sqlite from "./Sqlite.ts"

const untilReviews = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord({ "0001_init": init, "0002_reviews": reviews }),
  table: "migrations",
}).pipe(Effect.orDie)

describe("migration 0003_documents", () => {
  it.effect("keeps review attachments when it rebuilds the table, and lets a document own files", () =>
    Effect.gen(function* () {
      yield* untilReviews
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('a1', 'human', 'Lucas', '#5E6AD2', 1)`
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('w1', 'Personal', 'personal', 'a0', 1, 1)`
      yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at) VALUES ('p1', 'w1', 'Cello', 'CEL', '#5E6AD2', 1, 1)`
      yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at)
        VALUES ('s1', 'w1', 'Todo', 'unstarted', 'a0', '#999999', 1, 1)`
      yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
        VALUES ('t1', 'p1', 1, 'Evidence', 's1', 'a0', 'a1', 1, 1)`
      yield* sql`INSERT INTO reviews (id, task_id, summary, steps, actor_id, created_at) VALUES ('r1', 't1', 'Done', '[]', 'a1', 1)`
      yield* sql`INSERT INTO attachments (id, task_id, review_id, kind, name, path, caption, mime, bytes, poster_path, actor_id, created_at)
        VALUES ('f1', 't1', 'r1', 'video', 'flow.mp4', 't1/f1.mp4', 'The flow', 'video/mp4', 1024, 't1/f1.poster.jpg', 'a1', 1)`
      const before = yield* sql`SELECT id, task_id, review_id, kind, name, path, caption, mime, bytes, poster_path, actor_id, created_at FROM attachments`

      yield* Migrations.run
      expect(yield* sql`SELECT id, task_id, review_id, kind, name, path, caption, mime, bytes, poster_path, actor_id, created_at FROM attachments`)
        .toEqual(before)

      yield* sql`INSERT INTO documents (id, workspace_id, project_id, kind, slug, title, body, created_by_actor_id, updated_by_actor_id, created_at, updated_at)
        VALUES ('d1', 'w1', 'p1', 'page', 'report', 'Report', '# Report', 'a1', 'a1', 1, 1)`
      yield* sql`INSERT INTO attachments (id, document_id, kind, name, path, mime, bytes, sha256, actor_id, created_at)
        VALUES ('f2', 'd1', 'image', 'chart.png', 'documents/d1/f2.png', 'image/png', 10, 'abc', 'a1', 1)`
      // Every file belongs to a task or a document.
      const orphan = yield* Effect.exit(sql`INSERT INTO attachments (id, kind, name, actor_id, created_at) VALUES ('f3', 'file', 'x.txt', 'a1', 1)`)
      expect(orphan._tag).toBe("Failure")
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})

// Lucas's live board already has tasks and their events: 0007 adds the stage and "last changed" columns
// without touching anything else, and fills "last changed" from each task's latest event.
describe("migration 0007_task_stage", () => {
  const until0004 = SqliteMigrator.run({
    loader: SqliteMigrator.fromRecord({ "0001_init": init, "0002_reviews": reviews, "0003_documents": documents, "0004_inbox": inbox }),
    table: "migrations",
  }).pipe(Effect.orDie)

  it.effect("adds the columns, keeps every task, and backfills who changed each task last", () =>
    Effect.gen(function* () {
      yield* until0004
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('human', 'human', 'Lucas', '#5E6AD2', 1)`
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at) VALUES ('agent', 'agent', 'Claude Code', 'Claude Code', '#10B981', 1)`
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, identity_json, started_at, last_seen_at, created_at)
        VALUES ('sess', 'agent', '2fd0505c-1', 'Claude Code', '{}', 1, 1, 1)`
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('w1', 'Personal', 'personal', 'a0', 1, 1)`
      yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at) VALUES ('p1', 'w1', 'Cello', 'CEL', '#5E6AD2', 1, 1)`
      yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at)
        VALUES ('s1', 'w1', 'Todo', 'unstarted', 'a0', '#999999', 1, 1)`
      for (const n of [1, 2, 3]) {
        yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
          VALUES (${`t${n}`}, 'p1', ${n}, ${`Task ${n}`}, 's1', ${`a${n}`}, 'human', 1, 1)`
      }
      const event = (entityType: string, entityId: string, actor: string, session: string | null) =>
        sql`INSERT INTO events (ts, type, entity_type, entity_id, workspace_id, project_id, command_id, actor_id, session_id, schema_version, payload, created_at)
          VALUES (1, 'x.y', ${entityType}, ${entityId}, 'w1', 'p1', 'c', ${actor}, ${session}, 1, '{}', 1)`
      // t1: created by Lucas, then claimed by the agent session. t2: the agent's comment isn't a task change.
      yield* event("task", "t1", "human", null)
      yield* event("task", "t1", "agent", "sess")
      yield* event("task", "t2", "human", null)
      yield* event("comment", "t2", "agent", "sess")
      // t3 has no events at all: its creator stands in.
      const before = yield* sql`SELECT id, title, status_id, position, version FROM tasks ORDER BY id`

      yield* Migrations.run
      expect(yield* sql`SELECT id, title, status_id, position, version FROM tasks ORDER BY id`).toEqual(before)
      expect(yield* sql`SELECT id, stage, updated_by_actor_id, updated_by_session_id FROM tasks ORDER BY id`).toEqual([
        { id: "t1", stage: null, updated_by_actor_id: "agent", updated_by_session_id: "sess" },
        { id: "t2", stage: null, updated_by_actor_id: "human", updated_by_session_id: null },
        { id: "t3", stage: null, updated_by_actor_id: "human", updated_by_session_id: null },
      ])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
