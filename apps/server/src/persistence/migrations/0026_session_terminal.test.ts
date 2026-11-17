// Migration 0026_session_terminal (CEL-137) on a board with sessions: every session comes through as it
// was, with no terminal app; nothing is made up for sessions seen before.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const beforeTerminal = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0026_session_terminal"))),
  table: "migrations",
}).pipe(Effect.orDie)

describe("migration 0026_session_terminal", () => {
  it.effect("keeps every session as it was, adding an empty terminal app", () =>
    Effect.gen(function* () {
      yield* beforeTerminal
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at) VALUES ('a1', 'agent', 'Claude Code', 'Claude Code', '#3B82F6', 1)`
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, entrypoint, cwd, pid, identity_json, started_at, last_seen_at, created_at, model)
        VALUES ('s1', 'a1', 'c14ca1fa', 'Claude Code', 'cli', '/repo', 42, '{}', 1, 2, 1, 'claude-opus-5-5'),
               ('s2', 'a1', '0ee027f0', 'Claude Code', 'claude-desktop', NULL, NULL, '{}', 3, 4, 3, NULL)`
      const before = yield* sql`SELECT * FROM agent_sessions ORDER BY rowid`

      yield* Migrations.run

      const after = yield* sql<Record<string, unknown>>`SELECT * FROM agent_sessions ORDER BY rowid`
      expect(after.map(({ terminal, ...rest }) => rest)).toEqual(before)
      expect(after.map((row) => row.terminal)).toEqual([null, null])
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
