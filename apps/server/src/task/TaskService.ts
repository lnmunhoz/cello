// Tasks: numbered per project, ordered within (project, status), versioned on every change.
import type { CelloEvent } from "@cello/contract/events"
import type { Priority, Task } from "@cello/contract/entities"
import { Invalid, NotFound, VersionConflict } from "@cello/contract/errors"
import type { Caller } from "@cello/contract/rpcs"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import * as EventStore from "../events/EventStore.ts"
import { newId } from "../persistence/ids.ts"
import { selectTasks } from "../persistence/rows.ts"
import { place } from "../position/placement.ts"
import { placed, requireText } from "../validation.ts"

/** Neighbor task ids: `before` sits right above the task in its column, `after` right below. */
interface Neighbors {
  readonly before?: string | null
  readonly after?: string | null
}

export interface CreateTask extends Neighbors {
  readonly commandId: string
  readonly projectId: string
  readonly title: string
  readonly description?: string
  readonly statusId?: string
  readonly priority?: Priority
  readonly labelIds?: ReadonlyArray<string>
  readonly dueDate?: string | null
  readonly parentId?: string | null
}

export interface UpdateTask {
  readonly commandId: string
  readonly id: string
  readonly expectedVersion: number
  readonly title?: string
  readonly description?: string
  readonly priority?: Priority
  readonly dueDate?: string | null
  readonly parentId?: string | null
}

export interface MoveTask extends Neighbors {
  readonly commandId: string
  readonly id: string
  readonly expectedVersion?: number
  readonly statusId: string
}

export interface SetTaskLabels {
  readonly commandId: string
  readonly id: string
  readonly add: ReadonlyArray<string>
  readonly remove: ReadonlyArray<string>
}

type ById = { readonly commandId: string; readonly id: string }
type Write<E> = Effect.Effect<Commands.Written<Task>, E, Caller>

export class TaskService extends Context.Service<TaskService, {
  readonly create: (input: CreateTask) => Write<NotFound | Invalid>
  readonly update: (input: UpdateTask) => Write<NotFound | Invalid | VersionConflict>
  readonly move: (input: MoveTask) => Write<NotFound | Invalid | VersionConflict>
  readonly setLabels: (input: SetTaskLabels) => Write<NotFound | Invalid>
  readonly archive: (input: ById) => Write<NotFound>
  readonly unarchive: (input: ById) => Write<NotFound>
  readonly history: (id: string) => Effect.Effect<ReadonlyArray<CelloEvent>, NotFound>
}>()("cello/TaskService") {}

/** Fields `task.update` can change, and their columns. */
const EDITABLE = {
  title: "title",
  description: "description",
  priority: "priority",
  dueDate: "due_date",
  parentId: "parent_id",
} as const
type Editable = keyof typeof EDITABLE

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands
  const store = yield* EventStore.EventStore

  const load = (id: string) =>
    selectTasks(sql, sql`t.id = ${id}`).pipe(
      Effect.flatMap((rows) => rows[0] ? Effect.succeed(rows[0]) : Effect.fail(new NotFound({ entity: "task", id }))),
    )

  const workspaceOf = (projectId: string) =>
    sql<{ workspace_id: string }>`SELECT workspace_id FROM projects WHERE id = ${projectId}`.pipe(
      Effect.flatMap((rows) =>
        rows[0] ? Effect.succeed(rows[0].workspace_id) : Effect.fail(new NotFound({ entity: "project", id: projectId }))
      ),
    )

  const requireStatus = (workspaceId: string, statusId: string) =>
    sql<{ id: string }>`SELECT id FROM statuses WHERE id = ${statusId} AND workspace_id = ${workspaceId}`.pipe(
      Effect.flatMap((rows) => rows[0] ? Effect.void : Effect.fail(new NotFound({ entity: "status", id: statusId }))),
    )

  /** New tasks without a status go to the first visible column. */
  const defaultStatus = (workspaceId: string) =>
    sql<{ id: string }>`SELECT id FROM statuses WHERE workspace_id = ${workspaceId} ORDER BY hidden, position LIMIT 1`.pipe(
      Effect.map((rows) => rows[0]!.id),
    )

  const requireLabels = (workspaceId: string, labelIds: ReadonlyArray<string>) =>
    Effect.forEach(labelIds, (id) =>
      sql<{ id: string }>`
        SELECT id FROM labels WHERE id = ${id} AND workspace_id = ${workspaceId} AND archived_at IS NULL`.pipe(
        Effect.flatMap((rows) => rows[0] ? Effect.void : Effect.fail(new NotFound({ entity: "label", id }))),
      ), { discard: true })

  /** A parent must be another task in the same project, and not one of the task's own descendants. */
  const requireParent = (projectId: string, selfId: string | null, parentId: string) =>
    Effect.gen(function* () {
      if (parentId === selfId) return yield* new Invalid({ field: "parentId", reason: "a task can't be its own parent" })
      let cursor: string | null = parentId
      let first = true
      while (cursor !== null) {
        const rows: ReadonlyArray<{ project_id: string; parent_id: string | null }> = yield* sql<{
          project_id: string
          parent_id: string | null
        }>`SELECT project_id, parent_id FROM tasks WHERE id = ${cursor}`
        const row = rows[0]
        if (!row) return yield* new NotFound({ entity: "task", id: cursor })
        if (first && row.project_id !== projectId) {
          return yield* new Invalid({ field: "parentId", reason: "the parent must be in the same project" })
        }
        if (cursor === selfId) return yield* new Invalid({ field: "parentId", reason: "that would make a loop" })
        first = false
        cursor = row.parent_id
      }
    })

  const column = (projectId: string, statusId: string) =>
    sql<{ id: string; position: string }>`
      SELECT id, position FROM tasks WHERE project_id = ${projectId} AND status_id = ${statusId}`

  /** Fails with VersionConflict, naming whoever made the task's latest change. */
  const checkVersion = (task: Task, expected: number | undefined) =>
    Effect.gen(function* () {
      if (expected === undefined || expected === task.version) return
      const rows = yield* sql<{ name: string }>`
        SELECT a.name FROM events e JOIN actors a ON a.id = e.actor_id
        WHERE e.entity_id = ${task.id} ORDER BY e.seq DESC LIMIT 1`
      return yield* new VersionConflict({
        entity: "task",
        id: task.id,
        currentVersion: task.version,
        changedBy: rows[0]?.name ?? "someone",
      })
    })

  /** Writes changed columns and bumps the version: every task change goes through here. */
  const bump = (task: Task, now: number, columns: Record<string, unknown>) =>
    sql`UPDATE tasks SET ${sql.update({ ...columns, version: task.version + 1, updated_at: now })} WHERE id = ${task.id}`

  const create = Effect.fn("TaskService.create")(function* (input: CreateTask) {
    const title = yield* requireText("title", input.title)
    return yield* commands.write({ commandId: input.commandId, rpc: "task.create" }, ({ now, caller, emit }) =>
      Effect.gen(function* () {
        const workspaceId = yield* workspaceOf(input.projectId)
        const statusId = input.statusId ?? (yield* defaultStatus(workspaceId))
        if (input.statusId !== undefined) yield* requireStatus(workspaceId, statusId)
        const labelIds = [...new Set(input.labelIds ?? [])]
        yield* requireLabels(workspaceId, labelIds)
        const parentId = input.parentId ?? null
        if (parentId !== null) yield* requireParent(input.projectId, null, parentId)
        const { position } = yield* placed(place(yield* column(input.projectId, statusId), input))

        const numbers = yield* sql<{ number: number }>`
          UPDATE projects SET next_task_number = next_task_number + 1 WHERE id = ${input.projectId}
          RETURNING next_task_number - 1 AS number`
        const id = newId(now)
        yield* sql`INSERT INTO tasks (id, project_id, number, title, description, status_id, priority, position, due_date,
                                      parent_id, created_by_actor_id, created_by_session_id, version, created_at, updated_at)
          VALUES (${id}, ${input.projectId}, ${numbers[0]!.number}, ${title}, ${input.description ?? ""}, ${statusId},
                  ${input.priority ?? 0}, ${position}, ${input.dueDate ?? null}, ${parentId}, ${caller.actorId},
                  ${caller.sessionId}, 1, ${now}, ${now})`
        yield* Effect.forEach(labelIds, (labelId) =>
          sql`INSERT INTO task_labels (task_id, label_id, created_at) VALUES (${id}, ${labelId}, ${now})`, { discard: true })
        const task = yield* load(id)
        yield* emit({ type: "task.created", task }, { workspaceId, projectId: task.projectId })
        return task
      }))
  })

  const update = Effect.fn("TaskService.update")(function* (input: UpdateTask) {
    const next: Partial<Pick<Task, Editable>> = {
      ...(input.title === undefined ? {} : { title: yield* requireText("title", input.title) }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
    }
    return yield* commands.write({ commandId: input.commandId, rpc: "task.update" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const current = yield* load(input.id)
        yield* checkVersion(current, input.expectedVersion)
        const fields = (Object.keys(next) as Editable[]).filter((f) => next[f] !== current[f])
        if (fields.length === 0) return current
        if (fields.includes("parentId") && next.parentId != null) {
          yield* requireParent(current.projectId, current.id, next.parentId)
        }
        const before = Object.fromEntries(fields.map((f) => [f, current[f]]))
        const after = Object.fromEntries(fields.map((f) => [f, next[f]]))
        yield* bump(current, now, Object.fromEntries(fields.map((f) => [EDITABLE[f], next[f]])))
        const workspaceId = yield* workspaceOf(current.projectId)
        yield* emit(
          { type: "task.updated", id: current.id, before, after, version: current.version + 1 },
          { workspaceId, projectId: current.projectId },
        )
        return yield* load(current.id)
      }))
  })

  const move = Effect.fn("TaskService.move")(function* (input: MoveTask) {
    return yield* commands.write({ commandId: input.commandId, rpc: "task.move" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const current = yield* load(input.id)
        yield* checkVersion(current, input.expectedVersion)
        const workspaceId = yield* workspaceOf(current.projectId)
        yield* requireStatus(workspaceId, input.statusId)
        const sameColumn = input.statusId === current.statusId
        const { position, unchanged } = yield* placed(
          place(yield* column(current.projectId, input.statusId), {
            self: sameColumn ? current : undefined,
            before: input.before,
            after: input.after,
          }),
        )
        if (sameColumn && unchanged) return current
        yield* bump(current, now, { status_id: input.statusId, position })
        const task = yield* load(current.id)
        yield* emit(
          {
            type: "task.moved",
            id: task.id,
            from: { statusId: current.statusId, position: current.position },
            to: { statusId: task.statusId, position: task.position },
            version: task.version,
            task,
          },
          { workspaceId, projectId: task.projectId },
        )
        return task
      }))
  })

  const setLabels = Effect.fn("TaskService.setLabels")(function* (input: SetTaskLabels) {
    if (input.add.some((id) => input.remove.includes(id))) {
      return yield* new Invalid({ field: "add", reason: "a label can't be added and removed at once" })
    }
    return yield* commands.write({ commandId: input.commandId, rpc: "task.setLabels" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const current = yield* load(input.id)
        const workspaceId = yield* workspaceOf(current.projectId)
        const added = [...new Set(input.add)].filter((id) => !current.labelIds.includes(id))
        const removed = [...new Set(input.remove)].filter((id) => current.labelIds.includes(id))
        if (added.length === 0 && removed.length === 0) return current
        yield* requireLabels(workspaceId, added)
        yield* Effect.forEach(added, (labelId) =>
          sql`INSERT INTO task_labels (task_id, label_id, created_at) VALUES (${current.id}, ${labelId}, ${now})`, {
          discard: true,
        })
        yield* Effect.forEach(removed, (labelId) =>
          sql`DELETE FROM task_labels WHERE task_id = ${current.id} AND label_id = ${labelId}`, { discard: true })
        yield* bump(current, now, {})
        yield* emit(
          { type: "task.labels_changed", id: current.id, added, removed, version: current.version + 1 },
          { workspaceId, projectId: current.projectId },
        )
        return yield* load(current.id)
      }))
  })

  const setArchived = (rpc: "task.archive" | "task.unarchive", archived: boolean) =>
    Effect.fn(`TaskService.${archived ? "archive" : "unarchive"}`)(function* (input: ById) {
      return yield* commands.write({ commandId: input.commandId, rpc }, ({ now, emit }) =>
        Effect.gen(function* () {
          const current = yield* load(input.id)
          if ((current.archivedAt !== null) === archived) return current
          yield* bump(current, now, { archived_at: archived ? now : null })
          const workspaceId = yield* workspaceOf(current.projectId)
          yield* emit(
            { type: archived ? "task.archived" : "task.unarchived", id: current.id, version: current.version + 1 },
            { workspaceId, projectId: current.projectId },
          )
          return yield* load(current.id)
        }))
    })

  const history = Effect.fn("TaskService.history")(function* (id: string) {
    yield* load(id).pipe(Effect.catchTag("SqlError", Effect.die))
    return yield* store.history(id)
  })

  return TaskService.of({
    create,
    update,
    move,
    setLabels,
    archive: setArchived("task.archive", true),
    unarchive: setArchived("task.unarchive", false),
    history,
  })
})

export const layer = Layer.effect(TaskService, make)
