// Migration 0020_stage_planning (CEL-105): the stage `designing` was renamed `planning` after it had run on
// the live board, so a task may still hold `designing`, and so may a command receipt (the result a retry
// of the same command gets back). Those now say `planning`; everything else comes through as it was.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const beforePlanning = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0020_stage_planning"))),
  table: "migrations",
}).pipe(Effect.orDie)

describe("migration 0020_stage_planning", () => {
  it.effect("renames the stored stage designing to planning, and leaves every other task as it was", () =>
    Effect.gen(function* () {
      yield* beforePlanning
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('human', 'human', 'Lucas', '#3B82F6', 1)`
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('personal', 'Personal', 'personal', 'a0', 1, 1)`
      yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at)
        VALUES ('prog', 'personal', 'In Progress', 'started', 'a1', '#F59E0B', 1, 1)`
      yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at) VALUES ('cel', 'personal', 'Cello', 'CEL', '#5E6AD2', 1, 1)`
      for (const [n, stage] of [[1, "designing"], [2, "building"], [3, null], [4, "designing"], [5, "review"]] as const) {
        yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at, stage)
          VALUES (${`t${n}`}, 'cel', ${n}, ${`Task ${n}`}, 'prog', ${`a${n}`}, 'human', ${n}, ${n}, ${stage})`
      }
      const before = yield* sql<Record<string, unknown>>`SELECT * FROM tasks ORDER BY id`

      yield* Migrations.run

      const after = yield* sql<Record<string, unknown>>`SELECT * FROM tasks ORDER BY id`
      expect(after.map((t) => t.stage)).toEqual(["planning", "building", null, "planning", "review"])
      // Nothing else changed: not the other columns, not the other tasks. (0021 adds the last holder, CEL-110: null here.)
      for (const t of after) expect(t.last_holder_session_id).toBeNull()
      expect(after.map(({ stage, last_holder_session_id, ...rest }) => rest)).toEqual(before.map(({ stage, ...rest }) => rest))

      // The next start runs the migrations again: nothing changes.
      yield* Migrations.run
      expect(yield* sql`SELECT * FROM tasks ORDER BY id`).toEqual(after)
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))

  it.effect("renames designing in stored command results, a task's own and a task copy's inside one, and leaves the rest as it was", () =>
    Effect.gen(function* () {
      yield* beforePlanning
      const sql = yield* SqlClient.SqlClient
      // As Commands stores them: JSON.stringify of what the command returned.
      const results: Record<string, unknown> = {
        stage: { id: "t1", key: "CEL-1", stage: "designing", version: 3 },
        claim: { task: { id: "t2", stage: "designing" }, claimTaken: null },
        list: [{ id: "t3", stage: "designing" }, { id: "t4", stage: "building" }],
        building: { id: "t5", stage: "building" },
        // The word in a title is text, not a stage: its quotes are escaped, so it stays.
        title: { id: "t6", title: '"stage":"designing"', stage: null },
      }
      for (const [id, result] of Object.entries(results)) {
        yield* sql`INSERT INTO command_receipts (command_id, rpc, result, last_seq, created_at) VALUES (${id}, 'task.stage', ${JSON.stringify(result)}, 7, 1)`
      }

      yield* Migrations.run

      const read = Object.fromEntries((yield* sql<{ command_id: string; result: string; last_seq: number }>`SELECT command_id, result, last_seq FROM command_receipts`)
        .map((r) => [r.command_id, JSON.parse(r.result)]))
      expect(read).toEqual({
        stage: { id: "t1", key: "CEL-1", stage: "planning", version: 3 },
        claim: { task: { id: "t2", stage: "planning" }, claimTaken: null },
        list: [{ id: "t3", stage: "planning" }, { id: "t4", stage: "building" }],
        building: { id: "t5", stage: "building" },
        title: { id: "t6", title: '"stage":"designing"', stage: null },
      })
      const migrated = yield* sql`SELECT * FROM command_receipts ORDER BY command_id`
      yield* Migrations.run
      expect(yield* sql`SELECT * FROM command_receipts ORDER BY command_id`).toEqual(migrated)
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
