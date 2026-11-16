// Migration 0018_session_wake (CEL-92) on a board with sessions: Claude Code sessions get their agent
// kind, other sessions stay unknown, nothing else in agent_sessions changes, and the new tables take
// runs and settings with their checks.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const beforeWake = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0018_session_wake"))),
  table: "migrations",
}).pipe(Effect.orDie)

describe("migration 0018_session_wake", () => {
  it.effect("fills agent_kind for Claude Code sessions only, keeps the rest, and adds session_runs and wake_settings", () =>
    Effect.gen(function* () {
      yield* beforeWake
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('human', 'human', 'Lucas', '#3B82F6', 1)`
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at) VALUES ('a1', 'agent', 'Claude Code', 'Claude Code', '#3B82F6', 1)`
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('w1', 'Personal', 'personal', 'a0', 1, 1)`
      yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at) VALUES ('p1', 'w1', 'Cello', 'CEL', '#5E6AD2', 1, 1)`
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, cwd, pid, identity_json, started_at, last_seen_at, created_at)
        VALUES ('s1', 'a1', 'c14ca1fa', 'Claude Code', '/repo', 42, '{}', 1, 2, 1),
               ('s2', 'a1', 'other', 'Agent', NULL, NULL, '{}', 1, 2, 1)`
      const before = yield* sql`SELECT * FROM agent_sessions ORDER BY id`

      yield* Migrations.run
      const after = yield* sql<Record<string, unknown>>`SELECT * FROM agent_sessions ORDER BY id`
      // 0019 (CEL-106) adds the transcript and current step columns after it, 0022 (CEL-119) the model and effort, 0023 (CEL-124) orchestrating.
      expect(after.map(({ permission_mode, agent_kind, transcript_path, current_step, current_step_at, model, effort, orchestrating, background_json, tests_json, ...rest }) => rest)).toEqual(before)
      expect(after.map((r) => [r.id, r.agent_kind, r.permission_mode])).toEqual([["s1", "claude-code", null], ["s2", null, null]])

      yield* sql`INSERT INTO session_runs (id, session_id, task_id, why, agent_kind, mode, cello_mode, pid, started_at, outcome, log_path)
        VALUES ('r1', 's1', NULL, 'comment', 'claude-code', 'auto', 'auto', 99, 5, 'running', '/data/runs/s1/5.jsonl')`
      expect(yield* sql`SELECT id, outcome, ended_at FROM session_runs`).toEqual([{ id: "r1", outcome: "running", ended_at: null }])
      expect((yield* Effect.exit(sql`INSERT INTO session_runs (id, session_id, why, agent_kind, mode, cello_mode, started_at, outcome, log_path)
        VALUES ('r2', 's1', 'timer', 'claude-code', 'auto', 'auto', 5, 'running', 'x')`))._tag).toBe("Failure")

      yield* sql`INSERT INTO wake_settings (project_id, updated_at) VALUES ('p1', 3)`
      expect(yield* sql`SELECT enabled, cap_per_hour FROM wake_settings`).toEqual([{ enabled: 0, cap_per_hour: 3 }])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
