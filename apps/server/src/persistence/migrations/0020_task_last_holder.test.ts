// Migration 0020_task_last_holder (CEL-110) on a board with claim history: each task learns the agent
// session that last held its claim from its claim events; the human's claims, sessions that no longer
// exist and tasks nobody claimed leave it null. Every other column and row comes through as it was.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const beforeLastHolder = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0020_task_last_holder"))),
  table: "migrations",
}).pipe(Effect.orDie)

describe("migration 0020_task_last_holder", () => {
  it.effect("backfills each task's last agent holder from its claim events, and keeps every row as it was", () =>
    Effect.gen(function* () {
      yield* beforeLastHolder
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at) VALUES
        ('h', 'human', 'Lucas', NULL, '#000000', 1), ('a1', 'agent', 'Claude Code', 'Claude Code', '#3B82F6', 1)`
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, cwd, pid, identity_json, started_at, last_seen_at, created_at)
        VALUES ('s1', 'a1', 'c14ca1fa', 'Claude Code', '/repo', 42, '{}', 1, 2, 1), ('s2', 'a1', '7330433e', 'Claude Code', '/repo', 43, '{}', 1, 2, 1)`
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('w', 'Personal', 'personal', 'a0', 1, 1)`
      yield* sql`INSERT INTO projects (id, workspace_id, key, name, color, next_task_number, created_at, updated_at)
        VALUES ('p', 'w', 'CEL', 'Cello', '#000000', 5, 1, 1)`
      yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at)
        VALUES ('done', 'w', 'Done', 'completed', 'a5', '#000000', 1, 1)`
      for (const n of [1, 2, 3, 4]) {
        yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
          VALUES (${`t${n}`}, 'p', ${n}, ${`Task ${n}`}, 'done', ${`a${n}`}, 'h', 1, 1)`
      }
      const claim = (seq: number, task: string, type: string, session: string | null, eventSession: string | null) =>
        sql`INSERT INTO events (seq, ts, type, entity_type, entity_id, workspace_id, project_id, command_id, actor_id, session_id, schema_version, payload, created_at)
          VALUES (${seq}, ${seq}, ${type}, 'task', ${task}, 'w', 'p', ${`c${seq}`}, ${session === null ? "h" : "a1"}, ${eventSession}, 1,
                  ${JSON.stringify({ id: task, version: seq, task: { id: task, assigneeSessionId: session } })}, ${seq})`
      // t1: s1 claimed, then s2 took it over: s2.
      yield* claim(1, "t1", "task.claimed", "s1", "s1")
      yield* claim(2, "t1", "task.claim_taken", "s2", "s2")
      // t2: s1 claimed, then the human took it over: still s1.
      yield* claim(3, "t2", "task.claimed", "s1", "s1")
      yield* claim(4, "t2", "task.claim_taken", null, null)
      // t3: claimed by a session that no longer exists: nobody.
      yield* claim(5, "t3", "task.claimed", "gone", "gone")
      // t4: never claimed.
      const before = yield* sql`SELECT * FROM tasks ORDER BY id`
      const inboxBefore = yield* sql`SELECT * FROM inbox_items`

      yield* Migrations.run
      const after = yield* sql<Record<string, unknown>>`SELECT * FROM tasks ORDER BY id`
      expect(after.map((t) => [t.id, t.last_holder_session_id])).toEqual([["t1", "s2"], ["t2", "s1"], ["t3", null], ["t4", null]])
      expect(after.map(({ last_holder_session_id, ...rest }) => rest)).toEqual(before)
      expect(yield* sql`SELECT * FROM inbox_items`).toEqual(inboxBefore)
      const columns = yield* sql<{ name: string }>`SELECT name FROM pragma_table_info('inbox_items')`
      expect(columns.map((c) => c.name)).toContain("reopened_from")
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
