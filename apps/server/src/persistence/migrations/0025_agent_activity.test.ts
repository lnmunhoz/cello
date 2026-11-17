// Migration 0025_agent_activity (CEL-133, CEL-134) on a board with sessions and subagents: every row
// comes through as it was, with no background work, nothing waited on and no test run.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const before = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0025_agent_activity"))),
  table: "migrations",
}).pipe(Effect.orDie)

describe("migration 0025_agent_activity", () => {
  it.effect("keeps every session and subagent as it was, with empty background work, waiting and tests", () =>
    Effect.gen(function* () {
      yield* before
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at) VALUES ('a1', 'agent', 'Claude Code', 'Claude Code', '#3B82F6', 1)`
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, cwd, pid, identity_json, started_at, last_seen_at, created_at, current_step)
        VALUES ('s1', 'a1', 'c14ca1fa', 'Claude Code', '/repo', 42, '{}', 1, 2, 1, 'Bash · ls')`
      yield* sql`INSERT INTO session_agents (session_id, agent_id, agent_type, started_at, last_seen_at, ended_at)
        VALUES ('s1', 'a1b2', 'cello-builder', 3, 4, NULL), ('s1', 'c3d4', NULL, 5, 6, 7)`
      const sessions = yield* sql`SELECT * FROM agent_sessions ORDER BY id`
      const agents = yield* sql`SELECT * FROM session_agents ORDER BY agent_id`

      yield* Migrations.run
      // 0026 (CEL-137) adds the session's terminal app after it.
      const strip = ({ background_json, tests_json, waiting_json, terminal, ...rest }: Record<string, unknown>) => rest
      const sessionsAfter = yield* sql<Record<string, unknown>>`SELECT * FROM agent_sessions ORDER BY id`
      const agentsAfter = yield* sql<Record<string, unknown>>`SELECT * FROM session_agents ORDER BY agent_id`
      expect(sessionsAfter.map(strip)).toEqual(sessions)
      expect(agentsAfter.map(strip)).toEqual(agents)
      for (const row of sessionsAfter) expect([row.background_json, row.tests_json]).toEqual([null, null])
      for (const row of agentsAfter) expect([row.background_json, row.tests_json, row.waiting_json]).toEqual([null, null, null])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
