// Migration 0029_review_relayed (CEL-169) on a board with reviews: every row comes through as it was, with
// nobody marked as having relayed it; nothing is made up for approvals decided before. A second run changes nothing.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const beforeRelayed = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0029_review_relayed"))),
  table: "migrations",
}).pipe(Effect.orDie)

describe("migration 0029_review_relayed", () => {
  it.effect("keeps every review as it was, adding an empty relayed session; a second run changes nothing", () =>
    Effect.gen(function* () {
      yield* beforeRelayed
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('human', 'human', 'Lucas', '#3B82F6', 1),
        ('claude', 'agent', 'Claude Code', '#F97316', 2)`
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, identity_json, started_at, last_seen_at, created_at)
        VALUES ('s1', 'claude', 'c14ca1fa', 'Claude Code', '{}', 2, 2, 2)`
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('personal', 'Personal', 'personal', 'a0', 1, 1)`
      yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at)
        VALUES ('todo', 'personal', 'Todo', 'unstarted', 'a1', '#999999', 1, 1)`
      yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at) VALUES ('cel', 'personal', 'Cello', 'CEL', '#5E6AD2', 1, 1)`
      yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
        VALUES ('t1', 'cel', 1, 'Task 1', 'todo', 'a1', 'human', 3, 3)`
      yield* sql`INSERT INTO reviews (id, task_id, summary, steps, actor_id, session_id, created_at, decided_at, decision, decision_note)
        VALUES ('r1', 't1', 'Done', '["open it"]', 'claude', 's1', 3, 5, 'approved', 'Approved, commit'),
               ('r2', 't1', 'Again', '["open it"]', 'claude', 's1', 6, NULL, NULL, NULL)`
      const before = yield* sql`SELECT * FROM reviews ORDER BY rowid`

      yield* Migrations.run

      const after = yield* sql<Record<string, unknown>>`SELECT * FROM reviews ORDER BY rowid`
      expect(after.map(({ relayed_session_id, ...rest }) => rest)).toEqual(before)
      expect(after.map((row) => row.relayed_session_id)).toEqual([null, null])

      yield* sql`UPDATE reviews SET relayed_session_id = 's1' WHERE id = 'r1'`
      yield* Migrations.run
      expect(yield* sql`SELECT relayed_session_id FROM reviews ORDER BY rowid`).toEqual([{ relayed_session_id: "s1" }, { relayed_session_id: null }])
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
