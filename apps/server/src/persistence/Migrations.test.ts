// Upgrading a database that already has review evidence: 0003 rebuilds `attachments` (a page's files
// hang off its document, not a task) and must keep every row.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "./Migrations.ts"
import init from "./migrations/0001_init.ts"
import reviews from "./migrations/0002_reviews.ts"
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
