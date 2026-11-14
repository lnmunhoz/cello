import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as SqlClient from "effect/sql/SqlClient"
import { Caller } from "@cello/contract/rpcs"
import * as LabelService from "../label/LabelService.ts"
import * as ProjectService from "../project/ProjectService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asHuman, services, TEST_HUMAN } from "../testing/TestLayers.ts"
import * as TaskService from "./TaskService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

const count = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM ${sql(table)}`
    return rows[0]!.n
  }).pipe(Effect.orDie)

describe("TaskService.create", () => {
  it.effect("numbers tasks 1, 2, 3 per project and never reuses a number after archiving", () =>
    run(Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      const { workspace, project } = yield* setupProject
      const make = (title: string, projectId = project.id) =>
        tasks.create({ commandId: cmd(), projectId, title }).pipe(Effect.map((w) => w.result))

      const one = yield* make("One")
      const two = yield* make("Two")
      const three = yield* make("Three")
      expect([one.number, two.number, three.number]).toEqual([1, 2, 3])
      expect(three.key).toBe("CEL-3")

      yield* tasks.archive({ commandId: cmd(), id: three.id })
      expect((yield* make("Four")).number).toBe(4)

      const { result: other } = yield* setupProjectWithKey(workspace.id, "OTH")
      expect((yield* make("Elsewhere", other.id)).number).toBe(1)
    })))

  it.effect("writes the task and exactly one task.created event, in one transaction", () =>
    run(Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      const sql = yield* SqlClient.SqlClient
      const { project } = yield* setupProject
      const eventsBefore = yield* count("events")

      const { result: task, seq } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Write tests" })
      const events = yield* sql<{ seq: number; type: string; entity_id: string }>`
        SELECT seq, type, entity_id FROM events WHERE seq > ${0} ORDER BY seq`.pipe(Effect.orDie)
      expect(yield* count("events")).toBe(eventsBefore + 1)
      expect(events.at(-1)).toEqual({ seq, type: "task.created", entity_id: task.id })
    })))

  it.effect("a failure in the middle leaves neither the task nor the event", () =>
    run(Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      const sql = yield* SqlClient.SqlClient
      const { project } = yield* setupProject
      const eventsBefore = yield* count("events")
      // Make the event insert fail after the task row has been written.
      yield* sql`CREATE TRIGGER fail_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'disk on fire'); END`.pipe(
        Effect.orDie,
      )

      const exit = yield* Effect.exit(tasks.create({ commandId: cmd(), projectId: project.id, title: "Doomed" }))
      expect(Exit.hasDies(exit)).toBe(true)
      expect(yield* count("tasks")).toBe(0)
      expect(yield* count("events")).toBe(eventsBefore)
      expect(yield* count("command_receipts")).toBe(1) // only the project's
      const [{ next }] = (yield* sql<{ next: number }>`SELECT next_task_number AS next FROM projects`.pipe(Effect.orDie)) as [
        { next: number },
      ]
      expect(next).toBe(1)
    })))

  it.effect("puts a new task in the first visible column, at the bottom, with its labels", () =>
    run(Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      const labels = yield* LabelService.LabelService
      const { workspace, status, project } = yield* setupProject
      const { result: bug } = yield* labels.create({ commandId: cmd(), workspaceId: workspace.id, name: "Bug", color: "#ff0000" })

      const { result: first } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "A" })
      const { result: second } = yield* tasks.create({
        commandId: cmd(),
        projectId: project.id,
        title: "B",
        labelIds: [bug.id],
      })
      expect(first.statusId).toBe(status["Todo"]!.id)
      expect(second.position > first.position).toBe(true)
      expect(second.labelIds).toEqual([bug.id])
    })))

  it.effect("rejects an empty title, an unknown status and an unknown label", () =>
    run(Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      const { project } = yield* setupProject
      const fail = (input: Partial<TaskService.CreateTask>) =>
        Effect.flip(tasks.create({ commandId: cmd(), projectId: project.id, title: "T", ...input }))
      expect(yield* fail({ title: "  " })).toMatchObject({ _tag: "Invalid", field: "title" })
      expect(yield* fail({ statusId: "nope" })).toMatchObject({ _tag: "NotFound", entity: "status" })
      expect(yield* fail({ labelIds: ["nope"] })).toMatchObject({ _tag: "NotFound", entity: "label" })
      expect(yield* fail({ projectId: "nope" })).toMatchObject({ _tag: "NotFound", entity: "project" })
    })))
})

const setupProjectWithKey = (workspaceId: string, key: string) =>
  Effect.gen(function* () {
    const projects = yield* ProjectService.ProjectService
    return yield* projects.create({ commandId: cmd(), workspaceId, name: key, key })
  })

describe("TaskService.move", () => {
  const column = Effect.gen(function* () {
    const tasks = yield* TaskService.TaskService
    const ctx = yield* setupProject
    const todo = ctx.status["Todo"]!.id
    const make = (title: string) =>
      tasks.create({ commandId: cmd(), projectId: ctx.project.id, title, statusId: todo }).pipe(Effect.map((w) => w.result))
    const a = yield* make("A")
    const b = yield* make("B")
    const c = yield* make("C")
    const order = (statusId: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ title: string }>`
          SELECT title FROM tasks WHERE status_id = ${statusId} AND archived_at IS NULL ORDER BY position`.pipe(Effect.orDie)
        return rows.map((r) => r.title)
      })
    return { tasks, ...ctx, todo, a, b, c, order }
  })

  it.effect("places the card between its neighbors", () =>
    run(Effect.gen(function* () {
      const { tasks, todo, a, b, c, order } = yield* column
      const { result, seq } = yield* tasks.move({ commandId: cmd(), id: c.id, statusId: todo, before: a.id, after: b.id })
      expect(yield* order(todo)).toEqual(["A", "C", "B"])
      expect(result.version).toBe(2)
      expect(seq).not.toBeNull()
    })))

  it.effect("places the card at the top and at the bottom", () =>
    run(Effect.gen(function* () {
      const { tasks, todo, a, c, order } = yield* column
      yield* tasks.move({ commandId: cmd(), id: c.id, statusId: todo, after: a.id })
      expect(yield* order(todo)).toEqual(["C", "A", "B"])
      yield* tasks.move({ commandId: cmd(), id: a.id, statusId: todo, before: yield* lastId(todo) })
      expect(yield* order(todo)).toEqual(["C", "B", "A"])
    })))

  it.effect("moves the card into an empty column", () =>
    run(Effect.gen(function* () {
      const { tasks, status, b, order } = yield* column
      const done = status["Done"]!.id
      const { result } = yield* tasks.move({ commandId: cmd(), id: b.id, statusId: done })
      expect(result.statusId).toBe(done)
      expect(yield* order(done)).toEqual(["B"])
    })))

  it.effect("a move that changes nothing writes no event and keeps the version", () =>
    run(Effect.gen(function* () {
      const { tasks, todo, a, b, c } = yield* column
      const { result, seq } = yield* tasks.move({ commandId: cmd(), id: b.id, statusId: todo, before: a.id, after: c.id })
      expect(seq).toBeNull()
      expect(result.version).toBe(1)
    })))

  // Quick successive edits from one screen carry the version from before the previous edit landed.
  it.effect("an out-of-date expectedVersion is not a conflict when only the same caller changed it since", () =>
    run(Effect.gen(function* () {
      const { tasks, todo, a, b } = yield* column
      yield* tasks.update({ commandId: cmd(), id: a.id, expectedVersion: 1, title: "A2" })
      const { result } = yield* tasks.move({ commandId: cmd(), id: a.id, expectedVersion: 1, statusId: todo, before: b.id })
      expect(result).toMatchObject({ title: "A2", version: 3 })
    })))

  it.effect("a move with an out-of-date expectedVersion fails when someone else changed the task", () =>
    run(Effect.gen(function* () {
      const { tasks, todo, a, b } = yield* column
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at)
        VALUES ('claude', 'agent', 'Claude', 'Claude Code', '#D97706', 0)`.pipe(Effect.orDie)
      yield* tasks.update({ commandId: cmd(), id: a.id, expectedVersion: 1, title: "A2" }).pipe(
        Effect.provideService(Caller, { actorId: "claude", sessionId: null }),
      )
      const error = yield* Effect.flip(
        tasks.move({ commandId: cmd(), id: a.id, expectedVersion: 1, statusId: todo, before: b.id }),
      )
      expect(error).toMatchObject({ _tag: "VersionConflict", currentVersion: 2, changedBy: "Claude" })
    })))
})

const lastId = (statusId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ id: string }>`
      SELECT id FROM tasks WHERE status_id = ${statusId} ORDER BY position DESC LIMIT 1`.pipe(Effect.orDie)
    return rows[0]!.id
  })

describe("TaskService.update", () => {
  it.effect("a stale expectedVersion fails with VersionConflict naming who changed it", () =>
    run(Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      const sql = yield* SqlClient.SqlClient
      const { project } = yield* setupProject
      const { result: task } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Old" })

      // Another actor changes the task first.
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at)
        VALUES ('claude', 'agent', 'Claude', 'Claude Code', '#D97706', 0)`.pipe(Effect.orDie)
      yield* tasks.update({ commandId: cmd(), id: task.id, expectedVersion: 1, title: "By Claude" }).pipe(
        Effect.provideService(Caller, { actorId: "claude", sessionId: null }),
      )

      const error = yield* Effect.flip(tasks.update({ commandId: cmd(), id: task.id, expectedVersion: 1, title: "Mine" }))
      expect(error).toMatchObject({
        _tag: "VersionConflict",
        entity: "task",
        id: task.id,
        currentVersion: 2,
        changedBy: "Claude",
      })
    })))

  it.effect("writes only the changed fields, bumps the version, and skips a no-op", () =>
    run(Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      const { project } = yield* setupProject
      const { result: task } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Old" })

      const { result, seq } = yield* tasks.update({
        commandId: cmd(),
        id: task.id,
        expectedVersion: 1,
        title: "New",
        description: "",
        priority: 2,
      })
      expect(result).toMatchObject({ title: "New", priority: 2, version: 2 })
      const history = yield* tasks.history(task.id)
      expect(history.at(-1)).toMatchObject({
        seq,
        type: "task.updated",
        before: { title: "Old", priority: 0 },
        after: { title: "New", priority: 2 },
        version: 2,
      })

      const noop = yield* tasks.update({ commandId: cmd(), id: task.id, expectedVersion: 2, title: "New" })
      expect(noop.seq).toBeNull()
      expect(noop.result.version).toBe(2)
    })))

  it.effect("refuses a parent loop", () =>
    run(Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      const { project } = yield* setupProject
      const { result: parent } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Parent" })
      const { result: child } = yield* tasks.create({
        commandId: cmd(),
        projectId: project.id,
        title: "Child",
        parentId: parent.id,
      })
      const error = yield* Effect.flip(
        tasks.update({ commandId: cmd(), id: parent.id, expectedVersion: 1, parentId: child.id }),
      )
      expect(error).toMatchObject({ _tag: "Invalid", field: "parentId" })
    })))
})

describe("TaskService commands", () => {
  it.effect("running the same commandId twice returns the stored result and writes no second event", () =>
    run(Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      const { project } = yield* setupProject
      const commandId = cmd()
      const first = yield* tasks.create({ commandId, projectId: project.id, title: "Once" })
      const events = yield* count("events")
      const again = yield* tasks.create({ commandId, projectId: project.id, title: "Once" })
      expect(again).toEqual(first)
      expect(yield* count("events")).toBe(events)
      expect(yield* count("tasks")).toBe(1)
    })))
})

describe("TaskService labels and archiving", () => {
  it.effect("setLabels adds and removes, bumping the version once", () =>
    run(Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      const labels = yield* LabelService.LabelService
      const { workspace, project } = yield* setupProject
      const label = (name: string) =>
        labels.create({ commandId: cmd(), workspaceId: workspace.id, name, color: "#00FF00" }).pipe(Effect.map((w) => w.result))
      const bug = yield* label("Bug")
      const ui = yield* label("UI")
      const { result: task } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "T", labelIds: [bug.id] })

      const { result } = yield* tasks.setLabels({ commandId: cmd(), id: task.id, add: [ui.id], remove: [bug.id] })
      expect(result.labelIds).toEqual([ui.id])
      expect(result.version).toBe(2)
      const noop = yield* tasks.setLabels({ commandId: cmd(), id: task.id, add: [ui.id], remove: [] })
      expect(noop.seq).toBeNull()
    })))

  it.effect("archive and unarchive toggle archivedAt and bump the version", () =>
    run(Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      const { project } = yield* setupProject
      const { result: task } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "T" })
      const archived = yield* tasks.archive({ commandId: cmd(), id: task.id })
      expect(archived.result.archivedAt).not.toBeNull()
      expect(archived.result.version).toBe(2)
      const again = yield* tasks.archive({ commandId: cmd(), id: task.id })
      expect(again.seq).toBeNull()
      const back = yield* tasks.unarchive({ commandId: cmd(), id: task.id })
      expect(back.result).toMatchObject({ archivedAt: null, version: 3 })
      expect((yield* tasks.history(task.id)).map((e) => e.type)).toEqual(["task.created", "task.archived", "task.unarchived"])
    })))

  it.effect("history of an unknown task is NotFound", () =>
    run(Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      expect(yield* Effect.flip(tasks.history("nope"))).toMatchObject({ _tag: "NotFound", entity: "task" })
    })))
})
