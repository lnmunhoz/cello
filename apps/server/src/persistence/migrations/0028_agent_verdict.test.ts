// Migration 0028_agent_verdict (CEL-160) on a board with subagents: every row comes through as it was,
// with no verdict; nothing is made up for reviewers that finished before. Running it again changes nothing.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const beforeVerdict = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0028_agent_verdict"))),
  table: "migrations",
}).pipe(Effect.orDie)

describe("migration 0028_agent_verdict", () => {
  it.effect("keeps every subagent as it was, adding an empty verdict; a second run changes nothing", () =>
    Effect.gen(function* () {
      yield* beforeVerdict
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at) VALUES ('a1', 'agent', 'Claude Code', 'Claude Code', '#3B82F6', 1)`
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, identity_json, started_at, last_seen_at, created_at)
        VALUES ('s1', 'a1', 'c14ca1fa', 'Claude Code', '{}', 1, 2, 1)`
      yield* sql`INSERT INTO session_agents (session_id, agent_id, agent_type, task_id, description, started_at, last_seen_at, ended_at)
        VALUES ('s1', 'rev1', 'cello-code-reviewer', NULL, 'CEL-1 review', 3, 9, 9), ('s1', 'bld1', 'cello-builder', NULL, NULL, 4, 5, NULL)`
      const before = yield* sql`SELECT * FROM session_agents ORDER BY rowid`

      yield* Migrations.run

      const after = yield* sql<Record<string, unknown>>`SELECT * FROM session_agents ORDER BY rowid`
      expect(after.map(({ verdict, ...rest }) => rest)).toEqual(before)
      expect(after.map((row) => row.verdict)).toEqual([null, null])

      yield* sql`UPDATE session_agents SET verdict = 'merge' WHERE agent_id = 'rev1'`
      yield* Migrations.run
      expect(yield* sql`SELECT verdict FROM session_agents ORDER BY rowid`).toEqual([{ verdict: "merge" }, { verdict: null }])
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
