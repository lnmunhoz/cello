// Migration 0016_testing_profile (CEL-89) on a board with a project and its tasks: it adds the table for
// profile fields, changes nothing else, and the table holds one row per project and field.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const beforeProfiles = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0016_testing_profile"))),
  table: "migrations",
}).pipe(Effect.orDie)

describe("migration 0016_testing_profile", () => {
  it.effect("adds profile_fields without touching projects or tasks; one row per project and field", () =>
    Effect.gen(function* () {
      yield* beforeProfiles
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('human', 'human', 'Lucas', '#3B82F6', 1)`
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('w1', 'Personal', 'personal', 'a0', 1, 1)`
      yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at)
        VALUES ('s1', 'w1', 'Todo', 'unstarted', 'a0', '#999999', 1, 1)`
      yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at) VALUES ('p1', 'w1', 'Cello', 'CEL', '#5E6AD2', 1, 1)`
      yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
        VALUES ('t1', 'p1', 1, 'Profile', 's1', 'a0', 'human', 1, 1)`
      const before = { projects: yield* sql`SELECT * FROM projects`, tasks: yield* sql`SELECT * FROM tasks` }

      yield* Migrations.run
      // 0021 adds the tasks' last holder (CEL-110), null on a task nobody claimed.
      const tasks = (yield* sql<Record<string, unknown>>`SELECT * FROM tasks`).map(({ last_holder_session_id: _holder, milestone_id: _milestone, ...t }) => t)
      expect({ projects: yield* sql`SELECT * FROM projects`, tasks }).toEqual(before)
      yield* sql`INSERT INTO profile_fields (project_id, field, value, source, actor_id, session_id, updated_at)
        VALUES ('p1', 'unit', 'bun run test', 'detected', 'human', NULL, 2)`
      expect(yield* sql`SELECT field, value, source FROM profile_fields`).toEqual([{ field: "unit", value: "bun run test", source: "detected" }])
      expect((yield* Effect.exit(sql`INSERT INTO profile_fields (project_id, field, value, source, actor_id, updated_at)
        VALUES ('p1', 'unit', 'other', 'human', 'human', 3)`))._tag).toBe("Failure")
      expect((yield* Effect.exit(sql`INSERT INTO profile_fields (project_id, field, value, source, actor_id, updated_at)
        VALUES ('p1', 'install', 'x', 'robot', 'human', 3)`))._tag).toBe("Failure")
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
