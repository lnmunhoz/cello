// Migration 0015_project_labels (CEL-80) on a board shaped like the live one: labels belonged to the
// workspace, so a kind like `bug` is on tasks of two projects, areas are on one project's tasks, and some
// labels carry no task. After it each label belongs to one project, a shared one is copied for every other
// project that uses it, and every task still carries the same label names.
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

const beforeProjectLabels = migrationsUpTo("0014_inbox_read_via")
const throughProjectLabels = migrationsUpTo("0015_project_labels")

/**
 * Personal has three projects made one after another (CEL, then THAI's import, then FE) and Work one.
 * Labels: `bug` on 3 CEL tasks and 1 THAI task, `feature` on 1 CEL, 2 THAI (one archived) and 1 FE task,
 * `chore` on 2 CEL and 2 THAI tasks (a tie), `board` on CEL only, `decks` on THAI only, `mobile` on no
 * task but made right after THAI, `early` on no task and made before any project, `ui` archived and on a
 * CEL task, `legacy` archived and on CEL and THAI tasks, and Work's `bug`, on no task.
 */
const board = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO actors (id, kind, name, color, created_at) VALUES ('human', 'human', 'Lucas', '#3B82F6', 1)`
  yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES
    ('personal', 'Personal', 'personal', 'a0', 1, 1), ('work', 'Work', 'work', 'a1', 1, 1)`
  yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at) VALUES
    ('todo', 'personal', 'Todo', 'unstarted', 'a1', '#999999', 1, 1), ('w-todo', 'work', 'Todo', 'unstarted', 'a1', '#999999', 1, 1)`
  yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, created_at, updated_at) VALUES
    ('cel', 'personal', 'Cello', 'CEL', '#5E6AD2', 100, 100), ('thai', 'personal', 'ThaiLookup', 'THAI', '#5E6AD2', 200, 200),
    ('fe', 'personal', 'Focus', 'FE', '#5E6AD2', 300, 300), ('wrk', 'work', 'Work', 'WRK', '#5E6AD2', 50, 50)`
  const labels: ReadonlyArray<readonly [string, string, string, string, string, number, number | null]> = [
    ["l-bug", "personal", "bug", "#EF4444", "kind", 101, null],
    ["l-feature", "personal", "feature", "#3B82F6", "kind", 102, null],
    ["l-chore", "personal", "chore", "#6B7280", "kind", 103, null],
    ["l-board", "personal", "board", "#5B9A74", "area", 104, null],
    ["l-decks", "personal", "decks", "#8D7B68", "area", 201, null],
    ["l-mobile", "personal", "mobile", "#8D7B68", "area", 202, null],
    ["l-early", "personal", "early", "#999999", "none", 10, null],
    ["l-ui", "personal", "ui", "#999999", "none", 105, 400],
    ["l-legacy", "personal", "legacy", "#999999", "kind", 106, 401],
    ["w-bug", "work", "bug", "#EF4444", "kind", 60, null],
  ]
  for (const [id, ws, name, color, group, at, archived] of labels) {
    yield* sql`INSERT INTO labels (id, workspace_id, name, color, label_group, created_at, updated_at, archived_at)
      VALUES (${id}, ${ws}, ${name}, ${color}, ${group}, ${at}, ${at + 1}, ${archived})`
  }
  const tasks: ReadonlyArray<readonly [string, string, ReadonlyArray<string>, number | null]> = [
    ["cel-1", "cel", ["l-bug", "l-board", "l-chore"], null],
    ["cel-2", "cel", ["l-bug", "l-feature", "l-ui"], null],
    ["cel-3", "cel", ["l-bug", "l-chore", "l-legacy"], null],
    ["cel-4", "cel", [], null],
    ["thai-1", "thai", ["l-bug", "l-feature", "l-decks"], null],
    ["thai-2", "thai", ["l-feature", "l-chore", "l-legacy"], 500],
    ["thai-3", "thai", ["l-chore"], null],
    ["fe-1", "fe", ["l-feature"], null],
  ]
  let n = 0
  for (const [id, project, labelIds, archived] of tasks) {
    n++
    yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, created_at, updated_at, archived_at)
      VALUES (${id}, ${project}, ${n}, ${`Task ${n}`}, 'todo', ${`a${n}`}, 'human', ${n}, ${n}, ${archived})`
    for (const labelId of labelIds) yield* sql`INSERT INTO task_labels (task_id, label_id, created_at) VALUES (${id}, ${labelId}, ${n})`
  }
  yield* sql`INSERT INTO events (ts, type, entity_type, entity_id, workspace_id, project_id, command_id, actor_id, schema_version, payload, created_at)
    VALUES (101, 'label.created', 'label', 'l-bug', 'personal', NULL, 'cmd1', 'human', 1, '{"label":{"id":"l-bug"}}', 101)`
})

/** Each task's label names (and each label's colour, group and whether it's archived), by task. */
const taskLabels = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ task_id: string; name: string; color: string; label_group: string; archived: number }>`
    SELECT tl.task_id, l.name, l.color, l.label_group, l.archived_at IS NOT NULL AS archived
    FROM task_labels tl JOIN labels l ON l.id = tl.label_id ORDER BY tl.task_id, l.name`
  const byTask: Record<string, string[]> = {}
  for (const r of rows) (byTask[r.task_id] ??= []).push(`${r.name} ${r.color} ${r.label_group}${r.archived ? " archived" : ""}`)
  return byTask
})

type LabelRow = { id: string; workspace_id: string; project_id: string; name: string; color: string; label_group: string; created_at: number; updated_at: number; archived_at: number | null }

describe("migration 0015_project_labels", () => {
  it.effect("gives every label a project, copies a shared one for each other project using it, and every task keeps its labels", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* beforeProjectLabels
      yield* board
      const before = yield* taskLabels
      const tasksBefore = yield* sql`SELECT * FROM tasks ORDER BY id`
      const eventsBefore = yield* sql`SELECT * FROM events ORDER BY seq`

      yield* throughProjectLabels

      expect(yield* taskLabels).toEqual(before)
      expect(yield* sql`SELECT * FROM tasks ORDER BY id`).toEqual(tasksBefore)
      expect(yield* sql`SELECT * FROM events ORDER BY seq`).toEqual(eventsBefore)

      const labels = yield* sql<LabelRow>`SELECT * FROM labels ORDER BY project_id, name`
      const owners = labels.map((l) => `${l.project_id}:${l.name}`)
      expect(owners).toEqual([
        // CEL: its own bug (3 tasks to THAI's 1) and chore (2 to 2: the oldest project), board, early (made
        // before any project), ui and legacy (archived), and a copy of feature (THAI has more of it).
        "cel:board", "cel:bug", "cel:chore", "cel:early", "cel:feature", "cel:legacy", "cel:ui",
        "fe:feature",
        // THAI: feature (2 tasks, one archived), decks, mobile (made right after THAI), and copies of bug,
        // chore and legacy.
        "thai:bug", "thai:chore", "thai:decks", "thai:feature", "thai:legacy", "thai:mobile",
        "wrk:bug",
      ])
      const row = (project: string, name: string) => labels.find((l) => l.project_id === project && l.name === name)!
      // The project with most tasks keeps the original row; the others get copies with the same fields.
      expect(row("cel", "bug").id).toBe("l-bug")
      expect(row("thai", "feature").id).toBe("l-feature")
      expect(row("cel", "chore").id).toBe("l-chore")
      expect(row("thai", "mobile").id).toBe("l-mobile")
      expect(row("cel", "early").id).toBe("l-early")
      expect(row("wrk", "bug").id).toBe("w-bug")
      for (const [project, name, original] of [["thai", "bug", "l-bug"], ["cel", "feature", "l-feature"], ["fe", "feature", "l-feature"], ["thai", "chore", "l-chore"], ["thai", "legacy", "l-legacy"]] as const) {
        const copy = row(project, name)
        const source = labels.find((l) => l.id === original)!
        expect(copy.id).not.toBe(original)
        const { id: _a, project_id: _b, ...copied } = copy
        const { id: _c, project_id: _d, ...fields } = source
        expect(copied).toEqual(fields)
      }
      expect(row("thai", "legacy").archived_at).toBe(401)

      // Every task carries only its own project's labels.
      expect(yield* sql`
        SELECT tl.task_id FROM task_labels tl JOIN tasks t ON t.id = tl.task_id JOIN labels l ON l.id = tl.label_id
        WHERE l.project_id != t.project_id`).toEqual([])

      // Names are unique per project, ignoring case, archived labels included; another project may reuse one.
      expect((yield* Effect.exit(sql`INSERT INTO labels (id, workspace_id, project_id, name, color, created_at, updated_at)
        VALUES ('x1', 'personal', 'cel', 'BUG', '#999999', 1, 1)`))._tag).toBe("Failure")
      expect((yield* Effect.exit(sql`INSERT INTO labels (id, workspace_id, project_id, name, color, created_at, updated_at)
        VALUES ('x2', 'personal', 'cel', 'Legacy', '#999999', 1, 1)`))._tag).toBe("Failure")
      expect((yield* Effect.exit(sql`INSERT INTO labels (id, workspace_id, project_id, name, color, created_at, updated_at)
        VALUES ('x3', 'personal', 'fe', 'bug', '#999999', 1, 1)`))._tag).toBe("Success")
      // A label needs a project.
      expect((yield* Effect.exit(sql`INSERT INTO labels (id, workspace_id, name, color, created_at, updated_at)
        VALUES ('x4', 'personal', 'orphan', '#999999', 1, 1)`))._tag).toBe("Failure")
      yield* sql`DELETE FROM labels WHERE id = 'x3'`

      // The next start runs the migrations again: nothing changes.
      const migrated = yield* sql`SELECT * FROM labels ORDER BY id`
      const links = yield* sql`SELECT * FROM task_labels ORDER BY task_id, label_id`
      yield* Migrations.run
      expect(yield* sql`SELECT * FROM labels ORDER BY id`).toEqual(migrated)
      expect(yield* sql`SELECT * FROM task_labels ORDER BY task_id, label_id`).toEqual(links)
      expect(yield* sql`PRAGMA foreign_key_check`).toEqual([])
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))

  it.effect("drops a label whose workspace has no project to own it (no task can carry it)", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* beforeProjectLabels
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('empty', 'Empty', 'empty', 'a0', 1, 1)`
      yield* sql`INSERT INTO labels (id, workspace_id, name, color, created_at, updated_at) VALUES ('l-x', 'empty', 'x', '#999999', 1, 1)`
      yield* throughProjectLabels
      expect(yield* sql`SELECT * FROM labels`).toEqual([])
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
