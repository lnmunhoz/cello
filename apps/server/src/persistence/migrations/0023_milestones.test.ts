// Migration 0023_milestones (CEL-113) on a board shaped like the live one: CEL's Milestone labels M2
// (8 tasks: 6 Done, 1 Todo, 1 Backlog, one of the Done ones archived) and M3 (3 tasks) become milestones
// of the same names, in order, with their tasks; then the labels are gone. Edge cases: a task carrying
// both M2 and M3 (it gets M3, and its history notes M2), a Milestone label on no task (an empty
// milestone), two labels whose names clash once trimmed ("M3" and "M3 ": one milestone), an archived
// Milestone label (a closed milestone), and another project's M2 (its own milestone).
import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as EventStore from "../../events/EventStore.ts"
import * as Migrations from "../Migrations.ts"
import * as Sqlite from "../Sqlite.ts"

const beforeMilestones = SqliteMigrator.run({
  loader: SqliteMigrator.fromRecord(Object.fromEntries(Object.entries(Migrations.records).filter(([id]) => id < "0023_milestones"))),
  table: "migrations",
}).pipe(Effect.orDie)

const board = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at) VALUES ('h', 'human', 'Lucas', NULL, '#3B82F6', 1)`
  yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('w', 'Personal', 'personal', 'a0', 1, 1)`
  yield* sql`INSERT INTO statuses (id, workspace_id, name, category, position, color, created_at, updated_at) VALUES
    ('backlog', 'w', 'Backlog', 'backlog', 'a0', '#999999', 1, 1), ('todo', 'w', 'Todo', 'unstarted', 'a1', '#999999', 1, 1),
    ('done', 'w', 'Done', 'completed', 'a5', '#999999', 1, 1)`
  yield* sql`INSERT INTO projects (id, workspace_id, key, name, color, created_at, updated_at) VALUES
    ('cel', 'w', 'CEL', 'Cello', '#5E6AD2', 1, 1), ('thai', 'w', 'THAI', 'ThaiLookup', '#5E6AD2', 2, 2)`
  const labels: ReadonlyArray<readonly [string, string, string, string, number | null]> = [
    ["l-m3", "cel", "M3", "milestone", null],
    ["l-m2", "cel", "M2", "milestone", null],
    ["l-m3b", "cel", "M3 ", "milestone", null],
    ["l-m4", "cel", "M4", "milestone", null],
    ["l-m10", "cel", "M10", "milestone", null],
    ["l-m1", "cel", "M1", "milestone", 900],
    ["l-feature", "cel", "feature", "kind", null],
    ["l-board", "cel", "board", "area", null],
    ["t-m2", "thai", "M2", "milestone", null],
  ]
  let at = 10
  for (const [id, project, name, group, archived] of labels) {
    at++
    yield* sql`INSERT INTO labels (id, workspace_id, project_id, name, color, label_group, created_at, updated_at, archived_at)
      VALUES (${id}, 'w', ${project}, ${name}, '#26B5CE', ${group}, ${at}, ${at + 100}, ${archived})`
  }
  // CEL-1..6: M2, Done (CEL-6 archived); CEL-7: M2, Todo; CEL-8: M2, Backlog, and M3 too.
  // CEL-9, CEL-10: M3; CEL-11: "M3 " (the clashing name); CEL-12: archived M1; CEL-13: no milestone; THAI-1: THAI's M2.
  const tasks: ReadonlyArray<readonly [string, string, number, string, ReadonlyArray<string>, number | null]> = [
    ["c1", "cel", 1, "done", ["l-m2", "l-feature"], null],
    ["c2", "cel", 2, "done", ["l-m2"], null],
    ["c3", "cel", 3, "done", ["l-m2", "l-board"], null],
    ["c4", "cel", 4, "done", ["l-m2"], null],
    ["c5", "cel", 5, "done", ["l-m2"], null],
    ["c6", "cel", 6, "done", ["l-m2"], 800],
    ["c7", "cel", 7, "todo", ["l-m2"], null],
    ["c8", "cel", 8, "backlog", ["l-m3", "l-feature", "l-m2"], null],
    ["c9", "cel", 9, "todo", ["l-m3"], null],
    ["c10", "cel", 10, "done", ["l-m3"], null],
    ["c11", "cel", 11, "todo", ["l-m3b"], null],
    ["c12", "cel", 12, "done", ["l-m1"], null],
    ["c13", "cel", 13, "todo", ["l-feature"], null],
    ["th1", "thai", 1, "todo", ["t-m2"], null],
  ]
  for (const [id, project, number, status, labelIds, archived] of tasks) {
    yield* sql`INSERT INTO tasks (id, project_id, number, title, status_id, position, created_by_actor_id, version, created_at, updated_at, archived_at)
      VALUES (${id}, ${project}, ${number}, ${`Task ${number}`}, ${status}, ${`a${number}`}, 'h', 3, ${number}, ${number}, ${archived})`
    let n = 0
    for (const labelId of labelIds) yield* sql`INSERT INTO task_labels (task_id, label_id, created_at) VALUES (${id}, ${labelId}, ${++n})`
  }
})

interface MilestoneRow {
  id: string
  project_id: string
  name: string
  goal: string
  target_date: string | null
  position: string
  state: string
  closed_at: number | null
  created_at: number
  updated_at: number
}

describe("migration 0023_milestones", () => {
  it.effect("turns each Milestone label into a milestone with its tasks, notes a second label in history, and removes the labels", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* beforeMilestones
      yield* board
      const before = yield* sql<{ id: string; title: string; status_id: string; position: string; updated_at: number; version: number }>`
        SELECT id, title, status_id, position, updated_at, version FROM tasks ORDER BY id`

      yield* Migrations.run

      // One milestone per name in each project, in name order (M2 before M10); the archived label's is closed.
      const milestones = yield* sql<MilestoneRow>`SELECT * FROM milestones ORDER BY project_id, position`
      expect(milestones.map((m) => `${m.project_id}:${m.name}:${m.state}`)).toEqual([
        "cel:M1:closed", "cel:M2:open", "cel:M3:open", "cel:M4:open", "cel:M10:open",
        "thai:M2:open",
      ])
      const named = (project: string, name: string) => milestones.find((m) => m.project_id === project && m.name === name)!
      expect(named("cel", "M1")).toMatchObject({ closed_at: 900, goal: "", target_date: null })
      // It keeps the label's times: the label was made then.
      expect(named("cel", "M2")).toMatchObject({ created_at: 12, updated_at: 112, closed_at: null })

      // Each task is in the milestone its label named; CEL-8 had M2 and M3 and gets the later one, M3.
      const assigned = yield* sql<{ id: string; milestone_id: string | null }>`SELECT id, milestone_id FROM tasks ORDER BY id`
      const milestoneOf = Object.fromEntries(assigned.map((t) => [t.id, milestones.find((m) => m.id === t.milestone_id)?.name ?? null]))
      expect(milestoneOf).toEqual({
        c1: "M2", c2: "M2", c3: "M2", c4: "M2", c5: "M2", c6: "M2", c7: "M2",
        c8: "M3", c9: "M3", c10: "M3", c11: "M3",
        c12: "M1", c13: null, th1: "M2",
      })
      expect(assigned.find((t) => t.id === "th1")!.milestone_id).toBe(named("thai", "M2").id)

      // M2 holds 7 tasks (6 Done, one archived, and Todo) once CEL-8 went to M3; M3 holds 4; M4 and M10 none.
      const counts = yield* sql<{ name: string; tasks: number }>`
        SELECT m.name, COUNT(t.id) AS tasks FROM milestones m LEFT JOIN tasks t ON t.milestone_id = m.id
        WHERE m.project_id = 'cel' GROUP BY m.id ORDER BY m.position`
      expect(counts.map((c) => `${c.name} ${c.tasks}`)).toEqual(["M1 1", "M2 7", "M3 4", "M4 0", "M10 0"])

      // The Milestone labels are gone, from the tasks too; every other label stays where it was.
      expect(yield* sql`SELECT name FROM labels ORDER BY name`).toEqual([{ name: "board" }, { name: "feature" }])
      expect(yield* sql`SELECT task_id, label_id FROM task_labels ORDER BY task_id, label_id`).toEqual([
        { task_id: "c1", label_id: "l-feature" },
        { task_id: "c13", label_id: "l-feature" },
        { task_id: "c3", label_id: "l-board" },
        { task_id: "c8", label_id: "l-feature" },
      ])

      // A task that got a milestone has a new version (its history has a new line); nothing else about it changed.
      const after = yield* sql<{ id: string; title: string; status_id: string; position: string; updated_at: number; version: number }>`
        SELECT id, title, status_id, position, updated_at, version FROM tasks ORDER BY id`
      expect(after).toEqual(before.map((t) => ({ ...t, version: t.id === "c13" ? 3 : 4 })))

      // History: each milestone's creation, and on each task what became of its labels, as Lucas.
      const store = yield* EventStore.EventStore
      const m2 = named("cel", "M2")
      const [created] = yield* store.history(m2.id)
      expect(created).toMatchObject({
        type: "milestone.created",
        actorId: "h",
        sessionId: null,
        workspaceId: "w",
        projectId: "cel",
        milestone: { id: m2.id, projectId: "cel", name: "M2", goal: "", targetDate: null, position: m2.position, state: "open", closedAt: null },
      })
      const [both] = yield* store.history("c8")
      expect(both).toMatchObject({ type: "task.milestone_changed", id: "c8", version: 4, before: null, after: named("cel", "M3").id, fromLabels: ["M3", "M2"] })
      const [clashed] = yield* store.history("c11")
      expect(clashed).toMatchObject({ type: "task.milestone_changed", after: named("cel", "M3").id, fromLabels: ["M3 "] })
      expect(yield* store.history("c13")).toEqual([])

      // Names are unique per project, ignoring case; another project may reuse one. A milestone needs a project.
      expect((yield* Effect.exit(sql`INSERT INTO milestones (id, project_id, name, position, created_at, updated_at)
        VALUES ('x1', 'cel', 'm2', 'z', 1, 1)`))._tag).toBe("Failure")
      expect((yield* Effect.exit(sql`INSERT INTO milestones (id, project_id, name, position, state, created_at, updated_at)
        VALUES ('x2', 'thai', 'M3', 'z', 'done', 1, 1)`))._tag).toBe("Failure")

      // The next start runs the migrations again: nothing changes.
      const migrated = yield* sql`SELECT * FROM milestones ORDER BY id`
      const tasks = yield* sql`SELECT * FROM tasks ORDER BY id`
      const events = yield* sql`SELECT * FROM events ORDER BY seq`
      yield* Migrations.run
      expect(yield* sql`SELECT * FROM milestones ORDER BY id`).toEqual(migrated)
      expect(yield* sql`SELECT * FROM tasks ORDER BY id`).toEqual(tasks)
      expect(yield* sql`SELECT * FROM events ORDER BY seq`).toEqual(events)
      expect(yield* sql`PRAGMA foreign_key_check`).toEqual([])
      expect(yield* sql`PRAGMA integrity_check`).toEqual([{ integrity_check: "ok" }])
    }).pipe(Effect.provide(EventStore.layer), Effect.provide(Sqlite.layer(":memory:"))))

  it.effect("a board with no Milestone labels gets the table and the column, and nothing else changes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* beforeMilestones
      yield* Migrations.run
      expect(yield* sql`SELECT * FROM milestones`).toEqual([])
      expect(yield* sql`SELECT * FROM events`).toEqual([])
      const columns = yield* sql<{ name: string }>`PRAGMA table_info(tasks)`
      expect(columns.map((c) => c.name)).toContain("milestone_id")
    }).pipe(Effect.provide(Sqlite.layer(":memory:"))))
})
