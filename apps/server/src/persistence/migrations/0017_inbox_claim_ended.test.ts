// Migration 0017_inbox_claim_ended (CEL-46) on an inbox holding every kind of item there is, read and
// unread, taken each way: every row comes through as it was, and an item can now say that Lucas ended
// the session's claim (`claim_ended`, holding neither a comment nor an ask, with what he did as `cause`).
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

const beforeClaimEnded = migrationsUpTo("0016_testing_profile")
const throughClaimEnded = migrationsUpTo("0017_inbox_claim_ended")

/** Two sessions, a task, two comments and two asks on it, and an inbox item of every kind. */
const board = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('human', 'human', 'Lucas', '#3B82F6', 1),
    ('claude', 'agent', 'Claude Code', '#F97316', 2)`
  yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, identity_json, started_at, last_seen_at, created_at)
    VALUES ('sess', 'claude', '2fd0505c', 'Claude Code', '{}', 2, 2, 2), ('sess2', 'claude', 'd0d47d35', 'Claude Code', '{}', 2, 2, 2)`
  yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('personal', 'Personal', 'personal', 'a0', 1, 1)`
  yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at)
    VALUES ('todo', 'personal', 'Todo', 'unstarted', 'a1', '#999999', 1, 1)`
  yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at) VALUES ('cel', 'personal', 'Cello', 'CEL', '#5E6AD2', 1, 1)`
  yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
    VALUES ('t1', 'cel', 1, 'Task 1', 'todo', 'a1', 'human', 3, 3)`
  yield* sql`INSERT INTO comments (id, task_id, body, actor_id, created_at, updated_at) VALUES
    ('c1', 't1', 'Please cover the empty state', 'human', 4, 4), ('c2', 't1', 'The video is missing', 'human', 5, 5)`
  yield* sql`INSERT INTO asks (id, task_id, actor_id, session_id, title, questions, state, created_at) VALUES
    ('k1', 't1', 'claude', 'sess', 'Layout', '[]', 'answered', 6), ('k2', 't1', 'claude', 'sess', 'Wording', '[]', 'withdrawn', 7)`
  yield* sql`INSERT INTO inbox_items (id, session_id, comment_id, ask_id, task_id, kind, detail, created_at, read_at, read_via) VALUES
    ('i1', 'sess', 'c1', NULL, 't1', 'comment', NULL, 4, 8, 'hook'),
    ('i2', 'sess', 'c2', NULL, 't1', 'send_back', NULL, 5, 9, 'wait'),
    ('i3', 'sess', NULL, 'k1', 't1', 'answers', NULL, 6, 10, 'inbox'),
    ('i4', 'sess', NULL, 'k2', 't1', 'withdrawn', 'Todo', 7, NULL, NULL),
    ('i5', 'sess2', 'c1', NULL, 't1', 'comment', NULL, 4, NULL, NULL)`
})

const COLUMNS = "id, session_id, comment_id, ask_id, task_id, kind, detail, created_at, read_at, read_via"

describe("migration 0017_inbox_claim_ended", () => {
  it.effect("keeps every inbox item as it was, and lets an item say Lucas ended the claim", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* beforeClaimEnded
      yield* board
      const before = yield* sql.unsafe(`SELECT ${COLUMNS} FROM inbox_items ORDER BY rowid`)

      yield* throughClaimEnded

      expect(yield* sql.unsafe(`SELECT ${COLUMNS} FROM inbox_items ORDER BY rowid`)).toEqual(before)
      expect(yield* sql`SELECT cause FROM inbox_items`).toEqual(before.map(() => ({ cause: null })))

      // A claim_ended item holds neither a comment nor an ask, and says what Lucas did; a session may get
      // several, for one task too (the claim ends again after a new claim).
      const insert = (id: string, comment: string | null, ask: string | null, kind: string, cause: string | null) =>
        Effect.exit(sql`INSERT INTO inbox_items (id, session_id, comment_id, ask_id, task_id, kind, detail, cause, created_at)
          VALUES (${id}, 'sess', ${comment}, ${ask}, 't1', ${kind}, 'Todo', ${cause}, 11)`)
      expect((yield* insert("n1", null, null, "claim_ended", "moved"))._tag).toBe("Success")
      expect((yield* insert("n2", null, null, "claim_ended", "approved"))._tag).toBe("Success")
      // It needs a cause, and holds nothing else.
      expect((yield* insert("x1", null, null, "claim_ended", null))._tag).toBe("Failure")
      expect((yield* insert("x2", "c2", null, "claim_ended", "moved"))._tag).toBe("Failure")
      expect((yield* insert("x3", null, "k1", "claim_ended", "moved"))._tag).toBe("Failure")
      // The other kinds keep their rules: one of a comment or an ask, no cause; one item per comment or ask.
      expect((yield* insert("x4", null, null, "comment", null))._tag).toBe("Failure")
      expect((yield* insert("x5", "c2", "k1", "comment", null))._tag).toBe("Failure")
      expect((yield* insert("x6", "c2", null, "comment", "moved"))._tag).toBe("Failure")
      expect((yield* insert("x7", "c1", null, "comment", null))._tag).toBe("Failure")
      expect((yield* insert("x8", null, "k1", "answers", null))._tag).toBe("Failure")
      expect((yield* insert("x9", null, null, "nonsense", "moved"))._tag).toBe("Failure")
      expect((yield* Effect.exit(sql`UPDATE inbox_items SET read_via = 'email' WHERE id = 'n1'`))._tag).toBe("Failure")

      // Its indexes are back.
      expect((yield* sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'inbox_items' AND sql IS NOT NULL ORDER BY name`)
        .map((r) => r.name)).toEqual(["inbox_items_session", "inbox_items_unread"])

      // The next start runs the migrations again: nothing changes.
      const migrated = yield* sql`SELECT * FROM inbox_items ORDER BY rowid`
      yield* throughClaimEnded
      expect(yield* sql`SELECT * FROM inbox_items ORDER BY rowid`).toEqual(migrated)
      expect(yield* sql`PRAGMA foreign_key_check`).toEqual([])
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
