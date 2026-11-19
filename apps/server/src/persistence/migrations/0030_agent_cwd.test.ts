// Migration 0030_agent_cwd (CEL-152) on a board with subagents: every row comes through as it was, with no
// folder of its own (the Agents page then shows its session's); nothing is made up for agents seen before.
// Running it again changes nothing.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const beforeAgentCwd = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0030_agent_cwd"))),
  table: "migrations",
}).pipe(Effect.orDie)

describe("migration 0030_agent_cwd", () => {
  it.effect("keeps every subagent as it was, adding an empty folder; a second run changes nothing", () =>
    Effect.gen(function* () {
      yield* beforeAgentCwd
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at) VALUES ('a1', 'agent', 'Claude Code', 'Claude Code', '#3B82F6', 1)`
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, cwd, identity_json, started_at, last_seen_at, created_at)
        VALUES ('s1', 'a1', 'c14ca1fa', 'Claude Code', '/work/main', '{}', 1, 2, 1)`
      yield* sql`INSERT INTO session_agents (session_id, agent_id, agent_type, task_id, description, started_at, last_seen_at, ended_at)
        VALUES ('s1', 'rev1', 'cello-code-reviewer', NULL, 'CEL-1 review', 3, 9, 9), ('s1', 'bld1', 'cello-builder', NULL, NULL, 4, 5, NULL)`
      const before = yield* sql`SELECT * FROM session_agents ORDER BY rowid`
      const sessionsBefore = yield* sql`SELECT * FROM agent_sessions`

      yield* Migrations.run

      const after = yield* sql<Record<string, unknown>>`SELECT * FROM session_agents ORDER BY rowid`
      expect(after.map(({ cwd, ...rest }) => rest)).toEqual(before)
      expect(after.map((row) => row.cwd)).toEqual([null, null])
      expect(yield* sql`SELECT * FROM agent_sessions`).toEqual(sessionsBefore)

      yield* sql`UPDATE session_agents SET cwd = '/work/wt-a' WHERE agent_id = 'bld1'`
      yield* Migrations.run
      expect(yield* sql`SELECT cwd FROM session_agents ORDER BY rowid`).toEqual([{ cwd: null }, { cwd: "/work/wt-a" }])
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
