// Migration 0023_session_orchestrating (CEL-124) on a board with sessions: every session comes through as
// it was, not orchestrating; nothing is guessed for sessions that ran /cello:orchestrate before it.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const beforeOrchestrating = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0023_session_orchestrating"))),
  table: "migrations",
}).pipe(Effect.orDie)

describe("migration 0023_session_orchestrating", () => {
  it.effect("keeps every session as it was, adding orchestrating = 0; a new session starts at 0", () =>
    Effect.gen(function* () {
      yield* beforeOrchestrating
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at) VALUES ('a1', 'agent', 'Claude Code', 'Claude Code', '#3B82F6', 1)`
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, cwd, pid, identity_json, started_at, last_seen_at, ended_at, created_at, model)
        VALUES ('s1', 'a1', 'c14ca1fa', 'Claude Code', '/repo', 42, '{}', 1, 2, NULL, 1, 'claude-opus-5-5'),
               ('s2', 'a1', 'd0d47d35', 'Claude Code', '/repo', NULL, '{}', 3, 4, 5, 3, NULL)`
      const before = yield* sql`SELECT * FROM agent_sessions ORDER BY rowid`

      yield* Migrations.run

      const after = yield* sql<Record<string, unknown>>`SELECT * FROM agent_sessions ORDER BY rowid`
      expect(after.map(({ orchestrating, ...rest }) => rest)).toEqual(before)
      expect(after.map((row) => row.orchestrating)).toEqual([0, 0])
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, identity_json, started_at, last_seen_at, created_at)
        VALUES ('s3', 'a1', 'e1', 'Claude Code', '{}', 6, 6, 6)`
      expect(yield* sql`SELECT orchestrating FROM agent_sessions WHERE id = 's3'`).toEqual([{ orchestrating: 0 }])
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
