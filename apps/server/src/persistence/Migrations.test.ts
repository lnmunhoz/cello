// Upgrading a database that already has data. 0003 rebuilds `attachments` (a page's files hang off its
// document, not a task) and must keep every row. 0005 adds build history to a copy of a database that
// has a board on it, and changes nothing else. 0006 rebuilds `statuses` (a new category, under the
// tasks that reference it) and `inbox_items`, and adds Needs input to the workspaces that lack it.
import * as fs from "node:fs"
import * as path from "node:path"
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import { tempDataDir } from "../testing/tempDir.ts"
import * as Migrations from "./Migrations.ts"
import init from "./migrations/0001_init.ts"
import reviews from "./migrations/0002_reviews.ts"
import documents from "./migrations/0003_documents.ts"
import inbox from "./migrations/0004_inbox.ts"
import builds from "./migrations/0005_builds.ts"
import asks from "./migrations/0006_asks.ts"
import * as Sqlite from "./Sqlite.ts"

const untilReviews = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord({ "0001_init": init, "0002_reviews": reviews }),
  table: "migrations",
}).pipe(Effect.orDie)

describe("migration 0003_documents", () => {
  it.effect("keeps review attachments when it rebuilds the table, and lets a document own files", () =>
    Effect.gen(function* () {
      yield* untilReviews
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('a1', 'human', 'Lucas', '#5E6AD2', 1)`
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('w1', 'Personal', 'personal', 'a0', 1, 1)`
      yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at) VALUES ('p1', 'w1', 'Cello', 'CEL', '#5E6AD2', 1, 1)`
      yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at)
        VALUES ('s1', 'w1', 'Todo', 'unstarted', 'a0', '#999999', 1, 1)`
      yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
        VALUES ('t1', 'p1', 1, 'Evidence', 's1', 'a0', 'a1', 1, 1)`
      yield* sql`INSERT INTO reviews (id, task_id, summary, steps, actor_id, created_at) VALUES ('r1', 't1', 'Done', '[]', 'a1', 1)`
      yield* sql`INSERT INTO attachments (id, task_id, review_id, kind, name, path, caption, mime, bytes, poster_path, actor_id, created_at)
        VALUES ('f1', 't1', 'r1', 'video', 'flow.mp4', 't1/f1.mp4', 'The flow', 'video/mp4', 1024, 't1/f1.poster.jpg', 'a1', 1)`
      const before = yield* sql`SELECT id, task_id, review_id, kind, name, path, caption, mime, bytes, poster_path, actor_id, created_at FROM attachments`

      yield* Migrations.run
      expect(yield* sql`SELECT id, task_id, review_id, kind, name, path, caption, mime, bytes, poster_path, actor_id, created_at FROM attachments`)
        .toEqual(before)

      yield* sql`INSERT INTO documents (id, workspace_id, project_id, kind, slug, title, body, created_by_actor_id, updated_by_actor_id, created_at, updated_at)
        VALUES ('d1', 'w1', 'p1', 'page', 'report', 'Report', '# Report', 'a1', 'a1', 1, 1)`
      yield* sql`INSERT INTO attachments (id, document_id, kind, name, path, mime, bytes, sha256, actor_id, created_at)
        VALUES ('f2', 'd1', 'image', 'chart.png', 'documents/d1/f2.png', 'image/png', 10, 'abc', 'a1', 1)`
      // Every file belongs to a task or a document.
      const orphan = yield* Effect.exit(sql`INSERT INTO attachments (id, kind, name, actor_id, created_at) VALUES ('f3', 'file', 'x.txt', 'a1', 1)`)
      expect(orphan._tag).toBe("Failure")
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})

// Lucas's live board already has tasks and their events: 0007 adds the stage and "last changed" columns
// without touching anything else, and fills "last changed" from each task's latest event.
describe("migration 0007_task_stage", () => {
  it.effect("adds the columns, keeps every task, and backfills who changed each task last", () =>
    Effect.gen(function* () {
      yield* untilInbox
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('human', 'human', 'Lucas', '#5E6AD2', 1)`
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at) VALUES ('agent', 'agent', 'Claude Code', 'Claude Code', '#10B981', 1)`
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, identity_json, started_at, last_seen_at, created_at)
        VALUES ('sess', 'agent', '2fd0505c-1', 'Claude Code', '{}', 1, 1, 1)`
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('w1', 'Personal', 'personal', 'a0', 1, 1)`
      yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at) VALUES ('p1', 'w1', 'Cello', 'CEL', '#5E6AD2', 1, 1)`
      yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at)
        VALUES ('s1', 'w1', 'Todo', 'unstarted', 'a0', '#999999', 1, 1)`
      for (const n of [1, 2, 3]) {
        yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
          VALUES (${`t${n}`}, 'p1', ${n}, ${`Task ${n}`}, 's1', ${`a${n}`}, 'human', 1, 1)`
      }
      const event = (entityType: string, entityId: string, actor: string, session: string | null) =>
        sql`INSERT INTO events (ts, type, entity_type, entity_id, workspace_id, project_id, command_id, actor_id, session_id, schema_version, payload, created_at)
          VALUES (1, 'x.y', ${entityType}, ${entityId}, 'w1', 'p1', 'c', ${actor}, ${session}, 1, '{}', 1)`
      // t1: created by Lucas, then claimed by the agent session. t2: the agent's comment isn't a task change.
      yield* event("task", "t1", "human", null)
      yield* event("task", "t1", "agent", "sess")
      yield* event("task", "t2", "human", null)
      yield* event("comment", "t2", "agent", "sess")
      // t3 has no events at all: its creator stands in.
      const before = yield* sql`SELECT id, title, status_id, position, version FROM tasks ORDER BY id`

      yield* Migrations.run
      expect(yield* sql`SELECT id, title, status_id, position, version FROM tasks ORDER BY id`).toEqual(before)
      expect(yield* sql`SELECT id, stage, updated_by_actor_id, updated_by_session_id FROM tasks ORDER BY id`).toEqual([
        { id: "t1", stage: null, updated_by_actor_id: "agent", updated_by_session_id: "sess" },
        { id: "t2", stage: null, updated_by_actor_id: "human", updated_by_session_id: null },
        { id: "t3", stage: null, updated_by_actor_id: "human", updated_by_session_id: null },
      ])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})

const untilInbox = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord({ "0001_init": init, "0002_reviews": reviews, "0003_documents": documents, "0004_inbox": inbox }),
  table: "migrations",
}).pipe(Effect.orDie)

/** Every table's rows but the migrations bookkeeping and the new builds table: what 0005 must leave alone. */
const boardRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const tables = yield* sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('migrations', 'builds') AND name NOT LIKE 'sqlite_%' ORDER BY name`
  const rows: Record<string, unknown> = {}
  for (const { name } of tables) rows[name] = yield* sql.unsafe(`SELECT * FROM "${name}" ORDER BY rowid`)
  return rows
})

describe("migration 0005_builds", () => {
  it.effect("adds the builds table to a copy of a database with a board on it, keeps every row, and is safe to run again", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const original = path.join(dir, "cello.db")
      // A database as the live board has it before CEL-50: migrated to 0004, seeded, with a project and a task.
      const before = yield* Effect.gen(function* () {
        yield* untilInbox
        const sql = yield* SqlClient.SqlClient
        // Seeded as that build seeded it (today's defaults carry Needs input, a category 0004 doesn't know).
        yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('human', 'human', 'Lucas', '#3B82F6', 1)`
        yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('w1', 'Personal', 'personal', 'a0', 1, 1)`
        yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at)
          VALUES ('s1', 'w1', 'Todo', 'unstarted', 'a1', '#6B7280', 1, 1)`
        const [human] = yield* sql<{ id: string }>`SELECT id FROM actors`
        const [workspace] = yield* sql<{ id: string }>`SELECT id FROM workspaces`
        const [status] = yield* sql<{ id: string }>`SELECT id FROM statuses ORDER BY position LIMIT 1`
        yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at)
          VALUES ('p1', ${workspace!.id}, 'Cello', 'CEL', '#5E6AD2', 1, 1)`
        yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
          VALUES ('t1', 'p1', 1, 'Build history', ${status!.id}, 'a0', ${human!.id}, 1, 1)`
        return yield* boardRows
      }).pipe(Effect.provide(Sqlite.layer(original)), Effect.scoped)

      // Migrate a copy, the way a migration is checked before it reaches the live board.
      const copy = path.join(dir, "copy.db")
      fs.copyFileSync(original, copy)
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // Up to 0005 only: 0006 (asks, CEL-47) adds a status, and has its own test below.
        yield* beforeAsks
        expect(yield* boardRows).toEqual(before)
        expect(yield* sql`SELECT * FROM builds`).toEqual([])
        expect((yield* sql<{ name: string }>`SELECT name FROM migrations`).map((m) => m.name)).toContain("builds")

        // Again, as every server start does (nothing pending), and the migration itself twice: no change, no error.
        yield* beforeAsks
        yield* builds
        yield* sql`INSERT INTO builds (id, number, version, commit_hash, web_built_at, started_at, last_started_at, changes, created_at)
          VALUES ('0.2.0+aaaaaaa.1', 1, '0.2.0', 'aaaaaaa', 1, 2, 2, '[]', 2)`
        yield* builds
        expect(yield* sql`SELECT id FROM builds`).toEqual([{ id: "0.2.0+aaaaaaa.1" }])
        expect(yield* boardRows).toEqual(before)
      }).pipe(Effect.provide(Sqlite.layer(copy)), Effect.scoped)
    }).pipe(Effect.scoped))
})

/** Up to 0006: 0007 (task stage, CEL-35) changes task rows on purpose, and has its own test. */
const untilAsks = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord({ "0001_init": init, "0002_reviews": reviews, "0003_documents": documents, "0004_inbox": inbox, "0005_builds": builds, "0006_asks": asks }),
  table: "migrations",
}).pipe(Effect.orDie)

const beforeAsks = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord({ "0001_init": init, "0002_reviews": reviews, "0003_documents": documents, "0004_inbox": inbox, "0005_builds": builds }),
  table: "migrations",
}).pipe(Effect.orDie)

/**
 * A board as it is before CEL-47, with every table 0006 rebuilds or touches holding rows: Personal
 * (the default statuses), Work (renamed and reordered statuses, no In Review), Old (archived, with a
 * status of its own already named "needs input"), tasks in every status, some claimed, a review with
 * evidence, comments with inbox items (one read), a document and an event.
 */
const realisticBoard = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('human', 'human', 'Lucas', '#3B82F6', 1),
    ('claude', 'agent', 'Claude Code', '#F97316', 2)`
  yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, identity_json, started_at, last_seen_at, created_at)
    VALUES ('sess', 'claude', '2fd0505c', 'Claude Code', '{}', 2, 2, 2)`
  yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at, archived_at) VALUES
    ('personal', 'Personal', 'personal', 'a0', 1, 1, NULL), ('work', 'Work', 'work', 'a1', 1, 1, NULL), ('old', 'Old', 'old', 'a2', 1, 1, 9)`
  const statuses: ReadonlyArray<readonly [string, string, string, string, string, number]> = [
    ["p-backlog", "personal", "Backlog", "backlog", "a0", 1],
    ["p-todo", "personal", "Todo", "unstarted", "a1", 0],
    ["p-doing", "personal", "In Progress", "started", "a2", 0],
    ["p-review", "personal", "In Review", "started", "a3", 0],
    ["p-done", "personal", "Done", "completed", "a4", 0],
    ["p-canceled", "personal", "Canceled", "canceled", "a5", 1],
    ["w-todo", "work", "Up next", "unstarted", "Zz", 0],
    ["w-building", "work", "Building", "started", "a0V", 0],
    ["w-shipped", "work", "Shipped", "completed", "a1", 0],
    ["o-todo", "old", "Todo", "unstarted", "a1", 0],
    ["o-input", "old", "needs input", "started", "a2", 0],
    ["o-done", "old", "Done", "completed", "a3", 0],
  ]
  for (const [id, ws, name, category, position, hidden] of statuses) {
    yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, hidden, created_at, updated_at)
      VALUES (${id}, ${ws}, ${name}, ${category}, ${position}, '#999999', ${hidden}, 3, 4)`
  }
  yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at) VALUES
    ('cel', 'personal', 'Cello', 'CEL', '#5E6AD2', 1, 1), ('wrk', 'work', 'Work', 'WRK', '#5E6AD2', 1, 1), ('old', 'old', 'Old', 'OLD', '#5E6AD2', 1, 1)`
  let n = 0
  for (const [statusId, ws] of statuses) {
    const project = ws === "personal" ? "cel" : ws === "work" ? "wrk" : "old"
    for (let i = 0; i < 3; i++) {
      n++
      yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, assignee_actor_id, assignee_session_id,
                                    created_by_actor_id, version, created_at, updated_at)
        VALUES (${`t${n}`}, ${project}, ${n}, ${`Task ${n}`}, ${statusId}, ${`a${i}`}, ${i === 0 ? "claude" : null},
                ${i === 0 ? "sess" : null}, 'human', ${n}, ${n}, ${n})`
    }
  }
  yield* sql`INSERT INTO reviews (id, task_id, summary, steps, actor_id, session_id, created_at) VALUES ('r1', 't10', 'Done', '["Run it"]', 'claude', 'sess', 5)`
  yield* sql`INSERT INTO attachments (id, task_id, review_id, kind, name, path, caption, mime, bytes, poster_path, actor_id, session_id, created_at)
    VALUES ('f1', 't10', 'r1', 'video', 'flow.mp4', 't10/f1.mp4', 'The flow', 'video/mp4', 1024, 't10/f1.poster.jpg', 'claude', 'sess', 5)`
  yield* sql`INSERT INTO comments (id, task_id, body, actor_id, created_at, updated_at) VALUES
    ('c1', 't7', 'Please cover the empty state', 'human', 6, 6), ('c2', 't7', 'Also the dark theme', 'human', 7, 7)`
  yield* sql`INSERT INTO inbox_items (id, session_id, comment_id, task_id, kind, created_at, read_at) VALUES
    ('i1', 'sess', 'c1', 't7', 'comment', 6, 8), ('i2', 'sess', 'c2', 't7', 'send_back', 7, NULL)`
  yield* sql`INSERT INTO documents (id, workspace_id, project_id, kind, slug, title, body, created_by_actor_id, updated_by_actor_id, created_at, updated_at)
    VALUES ('d1', 'personal', 'cel', 'spec', 'needs-input', 'Needs input', '# Spec', 'human', 'human', 1, 1)`
  yield* sql`INSERT INTO events (ts, type, entity_type, entity_id, workspace_id, project_id, command_id, actor_id, schema_version, payload, created_at)
    VALUES (5, 'task.moved', 'task', 't10', 'personal', 'cel', 'cmd1', 'claude', 1, '{}', 5)`
})

/** Every row 0006 might touch, every column that was there before it. */
const everything = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return {
    statuses: yield* sql`SELECT id, workspace_id, name, category, position, color, hidden, created_at, updated_at FROM statuses ORDER BY id`,
    tasks: yield* sql`SELECT * FROM tasks ORDER BY id`,
    reviews: yield* sql`SELECT * FROM reviews ORDER BY id`,
    attachments: yield* sql`SELECT id, task_id, document_id, review_id, kind, name, path, url, caption, mime, bytes, poster_path, sha256,
                                   actor_id, session_id, created_at, deleted_at FROM attachments ORDER BY id`,
    comments: yield* sql`SELECT * FROM comments ORDER BY id`,
    inbox: yield* sql`SELECT id, session_id, comment_id, task_id, kind, created_at, read_at FROM inbox_items ORDER BY id`,
    documents: yield* sql`SELECT * FROM documents ORDER BY id`,
    events: yield* sql`SELECT * FROM events ORDER BY seq`,
  }
})

describe("migration 0006_asks", () => {
  it.effect("adds Needs input to every workspace without one, between In Progress and In Review, and changes nothing else", () =>
    Effect.gen(function* () {
      yield* beforeAsks
      yield* realisticBoard
      const sql = yield* SqlClient.SqlClient
      const before = yield* everything

      yield* untilAsks
      const after = yield* everything

      // Every existing row, every column, as it was; the only new rows are the Needs input statuses.
      const added = after.statuses.filter((s) => !before.statuses.some((b) => b.id === s.id))
      expect(after.statuses.filter((s) => before.statuses.some((b) => b.id === s.id))).toEqual(before.statuses)
      expect({ ...after, statuses: before.statuses }).toEqual(before)
      expect(added.map((s) => [s.workspace_id, s.name, s.category, s.hidden]).sort()).toEqual([
        ["personal", "Needs input", "waiting", 0],
        ["work", "Needs input", "waiting", 0],
      ])

      const order = (ws: string) =>
        sql<{ name: string }>`SELECT name FROM statuses WHERE workspace_id = ${ws} ORDER BY position`.pipe(
          Effect.map((rows) => rows.map((r) => r.name)),
        )
      expect(yield* order("personal")).toEqual(["Backlog", "Todo", "In Progress", "Needs input", "In Review", "Done", "Canceled"])
      expect(yield* order("work")).toEqual(["Up next", "Building", "Needs input", "Shipped"])
      // Old already had one of its own: left alone.
      expect(yield* order("old")).toEqual(["Todo", "needs input", "Done"])

      // The database is whole: every reference resolves, and the integrity check passes.
      expect(yield* sql`PRAGMA foreign_key_check`).toEqual([])
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
      // Foreign keys still hold on the rebuilt table; the new category is the only new one allowed.
      const orphan = yield* Effect.exit(sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at)
        VALUES ('tx', 'cel', 99, 'Orphan', 'no-such-status', 'a0', 'human', 1, 1)`)
      expect(orphan._tag).toBe("Failure")
      const bad = yield* Effect.exit(sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at)
        VALUES ('sx', 'work', 'Bad', 'later', 'b0', '#999999', 1, 1)`)
      expect(bad._tag).toBe("Failure")

      // The next start runs the migrations again: nothing changes.
      const migrated = yield* everything
      yield* untilAsks
      expect(yield* everything).toEqual(migrated)
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))

  it.effect("an inbox item holds a comment or an ask's answers, never both; a task has one open ask at most", () =>
    Effect.gen(function* () {
      yield* beforeAsks
      yield* realisticBoard
      yield* untilAsks
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO asks (id, task_id, actor_id, session_id, title, questions, state, created_at)
        VALUES ('k1', 't7', 'claude', 'sess', 'Which layout?', '[]', 'answered', 10)`
      yield* sql`INSERT INTO inbox_items (id, session_id, ask_id, task_id, kind, created_at) VALUES ('i3', 'sess', 'k1', 't7', 'answers', 10)`
      const both = yield* Effect.exit(sql`INSERT INTO inbox_items (id, session_id, comment_id, ask_id, task_id, kind, created_at)
        VALUES ('i4', 'sess', 'c1', 'k1', 't7', 'answers', 10)`)
      expect(both._tag).toBe("Failure")
      const twice = yield* Effect.exit(sql`INSERT INTO inbox_items (id, session_id, ask_id, task_id, kind, created_at)
        VALUES ('i5', 'sess', 'k1', 't7', 'answers', 11)`)
      expect(twice._tag).toBe("Failure")
      yield* sql`INSERT INTO asks (id, task_id, actor_id, title, questions, state, created_at) VALUES ('k2', 't7', 'claude', 'Again', '[]', 'open', 11)`
      const second = yield* Effect.exit(sql`INSERT INTO asks (id, task_id, actor_id, title, questions, state, created_at)
        VALUES ('k3', 't7', 'claude', 'And again', '[]', 'open', 12)`)
      expect(second._tag).toBe("Failure")
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})

/** Up to 0008: what the live board has run before CEL-52. */
const untilSearch = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0009"))),
  table: "migrations",
}).pipe(Effect.orDie)

const CEL_AREAS = ["board", "list", "task-panel", "review", "pages", "sidebar", "search", "viewer", "agents", "cli", "server", "data", "desktop", "tests", "release"]

// CEL-52: labels get a group (kind, area, milestone or none). Additive: one column with a default, then
// CEL-56's labels put in their groups by name, in any case. Nothing else changes.
describe("migration 0009_label_group", () => {
  it.effect("adds the group, fills it from CEL-56's names, and leaves every other row and column as it was", () =>
    Effect.gen(function* () {
      yield* untilSearch
      yield* realisticBoard
      const sql = yield* SqlClient.SqlClient
      const labels: ReadonlyArray<readonly [string, string, string, number | null]> = [
        ["l-feature", "personal", "feature", null],
        ["l-bug", "personal", "Bug", null],
        ["l-polish", "personal", "polish", null],
        ["l-chore", "personal", "chore", null],
        ["l-docs", "personal", "docs", null],
        ["l-m2", "personal", "M2", null],
        ["l-m3", "personal", "m3", null],
        ...CEL_AREAS.map((name) => [`l-${name}`, "personal", name, null] as const),
        ["l-ui", "personal", "ui", 9],
        ["l-later", "personal", "someday", null],
        ["w-bug", "work", "bug", null],
      ]
      for (const [id, ws, name, archived] of labels) {
        yield* sql`INSERT INTO labels (id, workspace_id, name, color, created_at, updated_at, archived_at)
          VALUES (${id}, ${ws}, ${name}, '#999999', 1, 2, ${archived})`
      }
      yield* sql`INSERT INTO task_labels (task_id, label_id, created_at) VALUES ('t1', 'l-bug', 1), ('t1', 'l-board', 1), ('t2', 'l-m2', 1)`
      const taskLabels = sql`SELECT * FROM task_labels ORDER BY task_id, label_id`
      const labelsBefore = yield* sql<Record<string, unknown>>`SELECT * FROM labels ORDER BY id`
      const before = { ...(yield* everything), taskLabels: yield* taskLabels }

      yield* Migrations.run
      const after = yield* sql<Record<string, unknown>>`SELECT * FROM labels ORDER BY id`
      expect(after.map(({ label_group: _, ...rest }) => rest)).toEqual(labelsBefore)
      expect({ ...(yield* everything), taskLabels: yield* taskLabels }).toEqual(before)

      const group = Object.fromEntries(after.map((l) => [l["id"], l["label_group"]]))
      expect(["l-feature", "l-bug", "l-polish", "l-chore", "l-docs", "w-bug"].map((id) => group[id])).toEqual(Array(6).fill("kind"))
      expect([group["l-m2"], group["l-m3"]]).toEqual(["milestone", "milestone"])
      expect(after.filter((l) => l["label_group"] === "area").map((l) => l["name"]).sort()).toEqual([...CEL_AREAS].sort())
      expect([group["l-ui"], group["l-later"]]).toEqual(["none", "none"])

      // A label made without a group is in none.
      yield* sql`INSERT INTO labels (id, workspace_id, name, color, created_at, updated_at) VALUES ('l-new', 'personal', 'new', '#999999', 3, 3)`
      expect(yield* sql`SELECT label_group FROM labels WHERE id = 'l-new'`).toEqual([{ label_group: "none" }])

      // The next start runs the migrations again: nothing changes.
      const migrated = yield* sql`SELECT * FROM labels ORDER BY id`
      yield* Migrations.run
      expect(yield* sql`SELECT * FROM labels ORDER BY id`).toEqual(migrated)
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
