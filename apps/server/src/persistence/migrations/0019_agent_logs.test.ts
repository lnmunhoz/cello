// Migration 0019_agent_logs (CEL-106) on a board with sessions and subagents: every row comes through
// as it was, with no transcript and no current step until a hook reports them.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const beforeLogs = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0019_agent_logs"))),
  table: "migrations",
}).pipe(Effect.orDie)

describe("migration 0019_agent_logs", () => {
  it.effect("keeps every session and subagent as it was, adding an empty transcript path and current step", () =>
    Effect.gen(function* () {
      yield* beforeLogs
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at) VALUES ('a1', 'agent', 'Claude Code', 'Claude Code', '#3B82F6', 1)`
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, cwd, pid, identity_json, started_at, last_seen_at, created_at)
        VALUES ('s1', 'a1', 'c14ca1fa', 'Claude Code', '/repo', 42, '{}', 1, 2, 1)`
      yield* sql`INSERT INTO session_agents (session_id, agent_id, agent_type, started_at, last_seen_at, ended_at)
        VALUES ('s1', 'a1b2', 'cello-builder', 3, 4, NULL), ('s1', 'c3d4', NULL, 5, 6, 7)`
      const sessions = yield* sql`SELECT * FROM agent_sessions ORDER BY id`
      const agents = yield* sql`SELECT * FROM session_agents ORDER BY agent_id`

      yield* Migrations.run
      // 0022 (CEL-119) adds the model and effort after it, 0023 (CEL-124) orchestrating on sessions.
      const strip = ({ transcript_path, current_step, current_step_at, model, effort, orchestrating, ...rest }: Record<string, unknown>) => rest
      const sessionsAfter = yield* sql<Record<string, unknown>>`SELECT * FROM agent_sessions ORDER BY id`
      const agentsAfter = yield* sql<Record<string, unknown>>`SELECT * FROM session_agents ORDER BY agent_id`
      expect(sessionsAfter.map(strip)).toEqual(sessions)
      expect(agentsAfter.map(strip)).toEqual(agents)
      for (const row of [...sessionsAfter, ...agentsAfter]) {
        expect([row.transcript_path, row.current_step, row.current_step_at]).toEqual([null, null, null])
      }
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
