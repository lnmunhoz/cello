// Upgrading a database that already has review evidence: 0003 rebuilds `attachments` (a page's files
// hang off its document, not a task) and must keep every row. 0005 adds build history to a copy of a
// database that has a board on it, and changes nothing else.
import * as fs from "node:fs"
import * as path from "node:path"
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import { tempDataDir } from "../testing/tempDir.ts"
import * as Migrations from "./Migrations.ts"
import init from "./migrations/0001_init.ts"
import reviews from "./migrations/0002_reviews.ts"
import documents from "./migrations/0003_documents.ts"
import inbox from "./migrations/0004_inbox.ts"
import builds from "./migrations/0005_builds.ts"
import * as Seed from "./Seed.ts"
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
  it.effect("adds the columns, keeps every task, and backfills who changed each task last", () =>
    Effect.gen(function* () {
      yield* untilInbox
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

const untilInbox = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord({ "0001_init": init, "0002_reviews": reviews, "0003_documents": documents, "0004_inbox": inbox }),
  table: "migrations",
}).pipe(Effect.orDie)

/** Up to 0005: later migrations (0007 adds task columns) change rows on purpose, and have their own tests. */
const untilBuilds = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord({ "0001_init": init, "0002_reviews": reviews, "0003_documents": documents, "0004_inbox": inbox, "0005_builds": builds }),
  table: "migrations",
}).pipe(Effect.orDie)

/** Every table's rows but the migrations bookkeeping and the new builds table: what 0005 must leave alone. */
const boardRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const tables = yield* sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('migrations', 'builds') AND name NOT LIKE 'sqlite_%' ORDER BY name`
  const rows: Record<string, unknown> = {}
  for (const { name } of tables) rows[name] = yield* sql.unsafe(`SELECT * FROM "${name}" ORDER BY rowid`)
  return rows
})

describe("migration 0005_builds", () => {
  it.effect("adds the builds table to a copy of a database with a board on it, keeps every row, and is safe to run again", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const original = path.join(dir, "cello.db")
      // A database as the live board has it before CEL-50: migrated to 0004, seeded, with a project and a task.
      const before = yield* Effect.gen(function* () {
        yield* untilInbox
        yield* Seed.seed("Lucas")
        const sql = yield* SqlClient.SqlClient
        const [human] = yield* sql<{ id: string }>`SELECT id FROM actors`
        const [workspace] = yield* sql<{ id: string }>`SELECT id FROM workspaces`
        const [status] = yield* sql<{ id: string }>`SELECT id FROM statuses ORDER BY position LIMIT 1`
        yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at)
          VALUES ('p1', ${workspace!.id}, 'Cello', 'CEL', '#5E6AD2', 1, 1)`
        yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
          VALUES ('t1', 'p1', 1, 'Build history', ${status!.id}, 'a0', ${human!.id}, 1, 1)`
        return yield* boardRows
      }).pipe(Effect.provide(Sqlite.layer(original)), Effect.scoped)

      // Migrate a copy, the way a migration is checked before it reaches the live board.
      const copy = path.join(dir, "copy.db")
      fs.copyFileSync(original, copy)
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* untilBuilds
        expect(yield* boardRows).toEqual(before)
        expect(yield* sql`SELECT * FROM builds`).toEqual([])
        expect((yield* sql<{ name: string }>`SELECT name FROM migrations`).map((m) => m.name)).toContain("builds")

        // Again, as every server start does (nothing pending), and the migration itself twice: no change, no error.
        yield* untilBuilds
        yield* builds
        yield* sql`INSERT INTO builds (id, number, version, commit_hash, web_built_at, started_at, last_started_at, changes, created_at)
          VALUES ('0.2.0+aaaaaaa.1', 1, '0.2.0', 'aaaaaaa', 1, 2, 2, '[]', 2)`
        yield* builds
        expect(yield* sql`SELECT id FROM builds`).toEqual([{ id: "0.2.0+aaaaaaa.1" }])
        expect(yield* boardRows).toEqual(before)
      }).pipe(Effect.provide(Sqlite.layer(copy)), Effect.scoped)
    }).pipe(Effect.scoped))
})
