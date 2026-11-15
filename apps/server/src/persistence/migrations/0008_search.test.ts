// Migration 0008_search on a board that already has data: it indexes every live task, comment, packet
// and document once, leaves out what's archived, deleted or superseded, changes no existing row, and
// both indexes agree with their content (FTS5's own integrity check). Run on a copy of a database
// file, the way a migration is checked before it reaches the live board.
import * as fs from "node:fs"
import * as path from "node:path"
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import { tempDataDir } from "../../testing/tempDir.ts"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

/** Every migration before this one, whatever lands before it. */
const beforeSearch = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0008_search"))),
  table: "migrations",
}).pipe(Effect.orDie)

const WORDS = ["evidence", "video", "review", "packet", "sidebar", "theme", "search", "comment", "backup", "restore", "stage", "label"]
const word = (n: number) => WORDS[n % WORDS.length]!

/**
 * A board the size of a few months' use: two workspaces, three projects (one archived), 300 tasks
 * (some archived) with markdown and accented descriptions, 900 comments (some deleted), packets in
 * every state (open, approved, sent back with a note, superseded), and documents (one archived).
 */
const realisticBoard = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('human', 'human', 'Lucas', '#3B82F6', 1), ('claude', 'agent', 'Claude Code', '#F97316', 2)`
  yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('personal', 'Personal', 'personal', 'a0', 1, 1), ('work', 'Work', 'work', 'a1', 1, 1)`
  yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at) VALUES
    ('todo', 'personal', 'Todo', 'unstarted', 'a1', '#999999', 1, 1), ('done', 'personal', 'Done', 'completed', 'a2', '#999999', 1, 1),
    ('w-todo', 'work', 'Todo', 'unstarted', 'a1', '#999999', 1, 1)`
  yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at, archived_at) VALUES
    ('cel', 'personal', 'Cello', 'CEL', '#5E6AD2', 1, 1, NULL), ('thai', 'personal', 'Thai Lookup', 'THAI', '#5E6AD2', 1, 1, NULL),
    ('old', 'work', 'Old', 'OLD', '#5E6AD2', 1, 1, 5)`
  const projects = [["cel", "todo"], ["thai", "done"], ["old", "w-todo"]] as const
  for (let n = 1; n <= 300; n++) {
    const [project, status] = projects[n % 3]!
    yield* sql`INSERT INTO tasks (id, project_id, number, title, description, status_id, position, created_by_actor_id, created_at, updated_at, archived_at)
      VALUES (${`t${n}`}, ${project}, ${n}, ${`Task ${n}: the ${word(n)} ${word(n + 3)}`},
              ${`## Why\n\nThe **${word(n + 1)}** café flow, step ${n}. Mentions CEL-${(n % 40) + 1}.`},
              ${status}, 'a0', 'human', ${n}, ${n}, ${n % 25 === 0 ? 1000 : null})`
  }
  for (let n = 1; n <= 900; n++) {
    yield* sql`INSERT INTO comments (id, task_id, body, actor_id, created_at, updated_at, deleted_at)
      VALUES (${`c${n}`}, ${`t${(n % 300) + 1}`}, ${`Re-recorded the ${word(n + 5)} videos; see CEL-${(n % 30) + 1}.`},
              ${n % 2 ? "human" : "claude"}, ${n}, ${n}, ${n % 50 === 0 ? 2000 : null})`
  }
  yield* sql`INSERT INTO reviews (id, task_id, summary, steps, actor_id, created_at, decided_at, decision, decision_note) VALUES
    ('r-open', 't1', 'Search everything', '["Press ⌘K", "Type evidence"]', 'claude', 10, NULL, NULL, NULL),
    ('r-approved', 't2', 'Backups every day', '[]', 'claude', 11, 12, 'approved', NULL),
    ('r-sent', 't4', 'Stages on cards', '["Open the board"]', 'claude', 13, 14, 'sent_back', 'The stage chip is too loud'),
    ('r-old', 't7', 'An older packet', '["Step"]', 'claude', 15, 16, 'superseded', NULL)`
  yield* sql`INSERT INTO documents (id, workspace_id, project_id, kind, slug, title, summary, body, created_by_actor_id, updated_by_actor_id, created_at, updated_at, archived_at) VALUES
    ('d-scope', 'personal', 'cel', 'spec', 'search-scope', 'Search scope', 'The bar and the index', '# Search scope\n\nFTS5 with porter stemming.', 'claude', 'claude', 20, 20, NULL),
    ('d-page', 'personal', 'thai', 'page', 'pricing', 'Baht prices', 'Checkout in baht', '# Baht prices', 'claude', 'claude', 21, 21, NULL),
    ('d-gone', 'personal', 'cel', 'doc', 'old-notes', 'Old notes', '', '# Old notes about evidence', 'human', 'human', 22, 22, 30)`
})

/** Every table but the migrations bookkeeping and the search tables: what the migration must leave alone. */
const boardRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const tables = yield* sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'migrations' AND name NOT LIKE 'search_%' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  const rows: Record<string, unknown> = {}
  for (const { name } of tables) rows[name] = yield* sql.unsafe(`SELECT * FROM "${name}" ORDER BY rowid`)
  return rows
})

const entries = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<{ kind: string; ref_id: string; task_key: string; title: string; body: string }>`
    SELECT kind, ref_id, task_key, title, body FROM search_entries ORDER BY kind, ref_id`
})

const matching = (table: "search_words" | "search_stems", query: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql.unsafe<{ kind: string; ref_id: string }>(
      `SELECT e.kind, e.ref_id FROM ${table} JOIN search_entries e ON e.id = ${table}.rowid WHERE ${table} MATCH ? ORDER BY e.kind, e.ref_id`,
      [query],
    )
    return rows.map((r) => `${r.kind}:${r.ref_id}`)
  })

describe("migration 0008_search", () => {
  it.effect("indexes a copy of a busy board's live rows once, changes no existing row, and is a no-op the next start", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const original = path.join(dir, "cello.db")
      const before = yield* Effect.gen(function* () {
        yield* beforeSearch
        yield* realisticBoard
        return yield* boardRows
      }).pipe(Effect.provide(Sqlite.layer(original)), Effect.scoped)

      const copy = path.join(dir, "copy.db")
      fs.copyFileSync(original, copy)
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* Migrations.run
        expect(yield* boardRows).toEqual(before)

        const indexed = yield* entries
        const count = (kind: string) => indexed.filter((e) => e.kind === kind).length
        // 300 tasks, 12 archived; 900 comments, 18 deleted; 4 packets, 1 superseded; 3 documents, 1 archived.
        expect(count("task")).toBe(288)
        expect(count("comment")).toBe(882)
        expect(indexed.filter((e) => e.kind === "packet").map((e) => e.ref_id)).toEqual(["r-approved", "r-open", "r-sent"])
        expect(indexed.filter((e) => e.kind === "document").map((e) => e.ref_id)).toEqual(["d-page", "d-scope"])
        expect(indexed.some((e) => e.ref_id === "t25" || e.ref_id === "c50")).toBe(false)

        // What each entry holds: the key, the title, and the body (a packet's steps and note on their own lines).
        expect(indexed.find((e) => e.ref_id === "t1")).toMatchObject({ task_key: "THAI-1", title: "Task 1: the video sidebar" })
        expect(indexed.find((e) => e.ref_id === "c1")).toMatchObject({ task_key: "OLD-2", title: "", body: "Re-recorded the search videos; see CEL-2." })
        expect(indexed.find((e) => e.ref_id === "r-open")?.body).toBe("Search everything\nPress ⌘K\nType evidence")
        expect(indexed.find((e) => e.ref_id === "r-sent")?.body).toBe("Stages on cards\nOpen the board\nThe stage chip is too loud")
        expect(indexed.find((e) => e.ref_id === "d-scope")).toMatchObject({ task_key: "", title: "Search scope" })

        // Both indexes answer from the backfill: prefixes on words, stems on stems, accents folded.
        expect(yield* matching("search_words", `"chip"*`)).toEqual(["packet:r-sent"])
        expect(yield* matching("search_words", `"cafe"`)).toHaveLength(288)
        expect(yield* matching("search_stems", `"video"`)).toHaveLength(882 + 72) // every live comment says "videos", and 72 live tasks "video"
        expect(yield* matching("search_words", `"porter"* "stem"*`)).toEqual(["document:d-scope"])
        expect(yield* matching("search_words", `task_key : "old 2"`)).toEqual(expect.arrayContaining(["task:t2", "comment:c1", "packet:r-approved"]))
        // FTS5 checks each index against its content table: it fails the statement if they disagree.
        yield* sql`INSERT INTO search_words (search_words, rank) VALUES ('integrity-check', 1)`
        yield* sql`INSERT INTO search_stems (search_stems, rank) VALUES ('integrity-check', 1)`
        expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])

        // The next start runs the migrations again: nothing changes.
        yield* Migrations.run
        expect(yield* entries).toEqual(indexed)
        expect(yield* boardRows).toEqual(before)
      }).pipe(Effect.provide(Sqlite.layer(copy)), Effect.scoped)
    }).pipe(Effect.scoped))
})
