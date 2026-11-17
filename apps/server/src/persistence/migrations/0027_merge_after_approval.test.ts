// Migration 0027_merge_after_approval (CEL-143) on a board with projects, inbox items of every kind and
// woken runs: every project keeps today's behaviour (merge after approval off), every inbox item and run
// comes through as it was, and from now on an inbox item can say Lucas approved a task (`approved`) and a
// woken run can be for an approval.
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const migrationsUpTo = (last: string) =>
  SqliteMigrator.run({
    loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id <= last))),
    table: "migrations",
  }).pipe(Effect.orDie)

const before = migrationsUpTo("0026_session_terminal")
const through = migrationsUpTo("0027_merge_after_approval")

/** Two projects, a session, a task with a comment and an ask, an inbox item of every kind, and two woken runs. */
const board = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('human', 'human', 'Lucas', '#3B82F6', 1),
    ('claude', 'agent', 'Claude Code', '#F97316', 2)`
  yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, identity_json, started_at, last_seen_at, created_at)
    VALUES ('sess', 'claude', '2fd0505c', 'Claude Code', '{}', 2, 2, 2)`
  yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('personal', 'Personal', 'personal', 'a0', 1, 1)`
  yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at)
    VALUES ('todo', 'personal', 'Todo', 'unstarted', 'a1', '#999999', 1, 1)`
  yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at)
    VALUES ('cel', 'personal', 'Cello', 'CEL', '#5E6AD2', 1, 1), ('thai', 'personal', 'ThaiLookup', 'THAI', '#10B981', 2, 2)`
  yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
    VALUES ('t1', 'cel', 1, 'Task 1', 'todo', 'a1', 'human', 3, 3)`
  yield* sql`INSERT INTO comments (id, task_id, body, actor_id, created_at, updated_at) VALUES
    ('c1', 't1', 'Please cover the empty state', 'human', 4, 4), ('c2', 't1', 'The video is missing', 'human', 5, 5)`
  yield* sql`INSERT INTO asks (id, task_id, actor_id, session_id, title, questions, state, created_at) VALUES
    ('k1', 't1', 'claude', 'sess', 'Layout', '[]', 'answered', 6), ('k2', 't1', 'claude', 'sess', 'Wording', '[]', 'withdrawn', 7)`
  yield* sql`INSERT INTO inbox_items (id, session_id, comment_id, ask_id, task_id, kind, detail, cause, reopened_from, created_at, read_at, read_via) VALUES
    ('i1', 'sess', 'c1', NULL, 't1', 'comment', 'In Progress', NULL, 'Done', 4, 8, 'hook'),
    ('i2', 'sess', 'c2', NULL, 't1', 'send_back', NULL, NULL, NULL, 5, 9, 'wait'),
    ('i3', 'sess', NULL, 'k1', 't1', 'answers', NULL, NULL, NULL, 6, 10, 'inbox'),
    ('i4', 'sess', NULL, 'k2', 't1', 'withdrawn', 'Todo', NULL, NULL, 7, NULL, NULL),
    ('i5', 'sess', NULL, NULL, 't1', 'claim_ended', 'Todo', 'moved', NULL, 8, NULL, NULL)`
  yield* sql`INSERT INTO session_runs (id, session_id, task_id, task_ids, why, agent_kind, mode, cello_mode, pid, started_at, ended_at, exit_code, outcome, error, log_path) VALUES
    ('r1', 'sess', 't1', '["t1"]', 'comment', 'claude-code', 'auto', 'auto', 4242, 10, 20, 0, 'completed', NULL, 'runs/sess/r1.log'),
    ('r2', 'sess', NULL, '[]', 'manual', 'claude-code', 'acceptEdits', 'edits', NULL, 30, NULL, NULL, 'running', NULL, 'runs/sess/r2.log')`
})

describe("migration 0027_merge_after_approval", () => {
  it.effect("keeps every project's behaviour (off) and every inbox item and run as it was; an item can now be an approval", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* before
      yield* board
      const projectsBefore = yield* sql`SELECT * FROM projects ORDER BY rowid`
      const inboxBefore = yield* sql`SELECT * FROM inbox_items ORDER BY rowid`
      const runsBefore = yield* sql`SELECT * FROM session_runs ORDER BY rowid`

      yield* through

      // Existing projects keep merge-before-review: the setting is off for each.
      const projects = yield* sql<Record<string, unknown>>`SELECT * FROM projects ORDER BY rowid`
      expect(projects.map(({ merge_after_approval, ...rest }) => rest)).toEqual(projectsBefore)
      expect(projects.map((p) => p.merge_after_approval)).toEqual([0, 0])
      expect(yield* sql`SELECT * FROM inbox_items ORDER BY rowid`).toEqual(inboxBefore)
      expect(yield* sql`SELECT * FROM session_runs ORDER BY rowid`).toEqual(runsBefore)

      // An approval item holds neither a comment nor an ask nor a cause; its note, if any, is its detail.
      const insert = (id: string, comment: string | null, ask: string | null, kind: string, cause: string | null) =>
        Effect.exit(sql`INSERT INTO inbox_items (id, session_id, comment_id, ask_id, task_id, kind, detail, cause, created_at)
          VALUES (${id}, 'sess', ${comment}, ${ask}, 't1', ${kind}, 'Ship it', ${cause}, 11)`)
      expect((yield* insert("n1", null, null, "approved", null))._tag).toBe("Success")
      expect((yield* insert("n2", null, null, "approved", null))._tag).toBe("Success")
      expect((yield* insert("x1", "c2", null, "approved", null))._tag).toBe("Failure")
      expect((yield* insert("x2", null, "k1", "approved", null))._tag).toBe("Failure")
      expect((yield* insert("x3", null, null, "approved", "moved"))._tag).toBe("Failure")
      // The other kinds keep their rules.
      expect((yield* insert("x4", null, null, "claim_ended", null))._tag).toBe("Failure")
      expect((yield* insert("x5", null, null, "comment", null))._tag).toBe("Failure")
      expect((yield* insert("x6", "c1", null, "comment", null))._tag).toBe("Failure")
      expect((yield* insert("x7", null, null, "nonsense", null))._tag).toBe("Failure")

      // A woken run can be for an approval; the other reasons stay as they were.
      const run = (id: string, why: string) =>
        Effect.exit(sql`INSERT INTO session_runs (id, session_id, task_id, why, agent_kind, mode, cello_mode, started_at, outcome, log_path)
          VALUES (${id}, 'sess', 't1', ${why}, 'claude-code', 'auto', 'auto', 40, 'running', 'runs/sess/x.log')`)
      expect((yield* run("r3", "approved"))._tag).toBe("Success")
      expect((yield* run("r4", "nonsense"))._tag).toBe("Failure")
      expect((yield* Effect.exit(sql`UPDATE session_runs SET outcome = 'exploded' WHERE id = 'r3'`))._tag).toBe("Failure")

      // Indexes are back.
      const indexes = (table: string) =>
        sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ${table} AND sql IS NOT NULL ORDER BY name`.pipe(
          Effect.map((rows) => rows.map((r) => r.name)),
        )
      expect(yield* indexes("inbox_items")).toEqual(["inbox_items_session", "inbox_items_unread"])
      expect(yield* indexes("session_runs")).toEqual(["session_runs_session", "session_runs_task"])

      // A new project row with no value given is off too (only ProjectService chooses on for new projects).
      yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at) VALUES ('new', 'personal', 'New', 'NEW', '#000000', 9, 9)`
      expect(yield* sql`SELECT merge_after_approval FROM projects WHERE id = 'new'`).toEqual([{ merge_after_approval: 0 }])

      // The next start runs the migrations again: nothing changes.
      const migrated = yield* sql`SELECT * FROM inbox_items ORDER BY rowid`
      yield* through
      expect(yield* sql`SELECT * FROM inbox_items ORDER BY rowid`).toEqual(migrated)
      expect(yield* sql`PRAGMA foreign_key_check`).toEqual([])
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
