// Migration 0022_writer_model (CEL-119) on a board with comments, events, sessions and subagents: every row
// comes through as it was, with no model and no effort; nothing is made up for what was written before.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const beforeModel = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0022_writer_model"))),
  table: "migrations",
}).pipe(Effect.orDie)

const TABLES = ["comments", "events", "agent_sessions", "session_agents"] as const

describe("migration 0022_writer_model", () => {
  it.effect("keeps every comment, event, session and subagent as it was, adding an empty model and effort", () =>
    Effect.gen(function* () {
      yield* beforeModel
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at) VALUES
        ('h', 'human', 'Lucas', NULL, '#000000', 1), ('a1', 'agent', 'Claude Code', 'Claude Code', '#3B82F6', 1)`
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, cwd, pid, identity_json, started_at, last_seen_at, created_at, transcript_path)
        VALUES ('s1', 'a1', 'c14ca1fa', 'Claude Code', '/repo', 42, '{}', 1, 2, 1, '/home/.claude/projects/-repo/c14ca1fa.jsonl')`
      yield* sql`INSERT INTO session_agents (session_id, agent_id, agent_type, started_at, last_seen_at, ended_at)
        VALUES ('s1', 'a1b2', 'cello-builder', 3, 4, NULL)`
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('w', 'Personal', 'personal', 'a0', 1, 1)`
      yield* sql`INSERT INTO projects (id, workspace_id, key, name, color, next_task_number, created_at, updated_at)
        VALUES ('p', 'w', 'CEL', 'Cello', '#000000', 2, 1, 1)`
      yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at)
        VALUES ('todo', 'w', 'Todo', 'unstarted', 'a1', '#000000', 1, 1)`
      yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
        VALUES ('t1', 'p', 1, 'Task 1', 'todo', 'a1', 'h', 1, 1)`
      yield* sql`INSERT INTO comments (id, task_id, body, actor_id, session_id, agent_id, created_at, updated_at)
        VALUES ('c1', 't1', 'From the session', 'a1', 's1', NULL, 5, 5), ('c2', 't1', 'From its builder', 'a1', 's1', 'a1b2', 6, 6),
               ('c3', 't1', 'From Lucas', 'h', NULL, NULL, 7, 7)`
      yield* sql`INSERT INTO events (ts, type, entity_type, entity_id, workspace_id, project_id, command_id, actor_id, session_id, agent_id, schema_version, payload, created_at)
        VALUES (5, 'comment.added', 'comment', 'c1', 'w', 'p', 'k1', 'a1', 's1', NULL, 1, '{}', 5),
               (6, 'comment.added', 'comment', 'c2', 'w', 'p', 'k2', 'a1', 's1', 'a1b2', 1, '{}', 6)`
      const before = new Map<string, ReadonlyArray<unknown>>()
      for (const table of TABLES) before.set(table, yield* sql`SELECT * FROM ${sql(table)} ORDER BY rowid`)

      yield* Migrations.run

      for (const table of TABLES) {
        const after = yield* sql<Record<string, unknown>>`SELECT * FROM ${sql(table)} ORDER BY rowid`
        // 0023 (CEL-124) adds orchestrating to sessions after it.
        expect(after.map(({ model, effort, orchestrating, ...rest }) => rest)).toEqual(before.get(table))
        for (const row of after) expect([row.model, row.effort]).toEqual([null, null])
      }
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
