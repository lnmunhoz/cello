// Tasks: numbered per project, ordered within (project, status), versioned on every change.
import type { CelloEvent } from "@cello/contract/events"
import type { Priority, Task } from "@cello/contract/entities"
import { Invalid, NotFound, TaskClaimed, VersionConflict } from "@cello/contract/errors"
import type { Caller } from "@cello/contract/rpcs"
import { parseTaskKey } from "@cello/shared/taskKey"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import * as EventStore from "../events/EventStore.ts"
import { newId } from "../persistence/ids.ts"
import { selectTasks } from "../persistence/rows.ts"
import * as Seed from "../persistence/Seed.ts"
import { isGone, SessionService } from "../session/SessionService.ts"
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
type ByKey = { readonly commandId: string; readonly key: string }
type Write<E> = Effect.Effect<Commands.Written<Task>, E, Caller>

export class TaskService extends Context.Service<TaskService, {
  readonly create: (input: CreateTask) => Write<NotFound | Invalid>
  readonly update: (input: UpdateTask) => Write<NotFound | Invalid | VersionConflict>
  readonly move: (input: MoveTask) => Write<NotFound | Invalid | VersionConflict>
  readonly setLabels: (input: SetTaskLabels) => Write<NotFound | Invalid>
  readonly archive: (input: ById) => Write<NotFound>
  readonly unarchive: (input: ById) => Write<NotFound>
  readonly history: (id: string) => Effect.Effect<ReadonlyArray<CelloEvent>, NotFound>
  /** A task by its key ("CEL-3"), archived ones included. */
  readonly byKey: (key: string) => Effect.Effect<Task, NotFound>
  /**
   * Assigns the task to the caller's session and moves it to the first started status (unless it's
   * already in one). Fails with TaskClaimed while another live session holds it; a gone holder's
   * claim is taken over (`task.claim_taken`). The human always wins.
   */
  readonly claim: (input: ByKey) => Write<NotFound | TaskClaimed>
  /** Gives up the caller's claim; the human can release anyone's. The status stays. */
  readonly release: (input: ByKey) => Write<NotFound | Invalid>
}>()("cello/TaskService") {}

/** Statuses whose tasks are finished: a claim on them no longer holds. */
const FINISHED = new Set(["completed", "canceled"])

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
  const sessions = yield* SessionService
  const human = yield* Seed.HumanActor

  const load = (id: string) =>
    selectTasks(sql, sql`t.id = ${id}`).pipe(
      Effect.flatMap((rows) => rows[0] ? Effect.succeed(rows[0]) : Effect.fail(new NotFound({ entity: "task", id }))),
    )

  const loadByKey = (key: string) =>
    Effect.gen(function* () {
      const parsed = parseTaskKey(key)
      if (!parsed) return yield* new NotFound({ entity: "task", id: key })
      const rows = yield* selectTasks(sql, sql`p.key = ${parsed.projectKey} AND t.number = ${parsed.number}`)
      return rows[0] ?? (yield* new NotFound({ entity: "task", id: key }))
    })

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

  /** Where a claim moves a task that isn't started yet. */
  const firstStarted = (workspaceId: string) =>
    sql<{ id: string }>`
      SELECT id FROM statuses WHERE workspace_id = ${workspaceId} AND category = 'started' ORDER BY position LIMIT 1`.pipe(
      Effect.map((rows) => rows[0]!.id),
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

  /**
   * Fails with VersionConflict when someone other than the caller changed the task after `expected`,
   * naming the latest of them. The caller's own newer changes don't count: quick successive edits from
   * one screen carry the version from before the previous edit landed.
   */
  const checkVersion = (task: Task, expected: number | undefined, caller: { actorId: string; sessionId: string | null }) =>
    Effect.gen(function* () {
      if (expected === undefined || expected === task.version) return
      const rows = yield* sql<{ name: string }>`
        SELECT a.name FROM events e JOIN actors a ON a.id = e.actor_id
        WHERE e.entity_id = ${task.id}
          AND json_extract(e.payload, '$.version') > ${expected}
          AND NOT (e.actor_id = ${caller.actorId} AND e.session_id IS ${caller.sessionId})
        ORDER BY e.seq DESC LIMIT 1`
      if (rows.length === 0) return
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

  /** Who holds the task's claim, if anyone. */
  const holderOf = (task: Task) =>
    task.assigneeActorId === null ? null : { actorId: task.assigneeActorId, sessionId: task.assigneeSessionId }

  const categoryOf = (statusId: string) =>
    sql<{ category: string }>`SELECT category FROM statuses WHERE id = ${statusId}`.pipe(Effect.map((rows) => rows[0]!.category))

  /**
   * A human change ends an agent's claim. Returns the columns that clear it (merged into the change's
   * own `bump`) and `after(version)`, which emits `task.claim_ended` once the change's event is out.
   */
  const humanEndsClaim = (task: Task, workspaceId: string, { caller, emit }: Commands.WriteContext) => {
    const holder = holderOf(task)
    if (caller.sessionId !== null || holder === null || holder.sessionId === null) {
      return { columns: {}, after: (_version: number) => Effect.void }
    }
    return {
      columns: { assignee_actor_id: null, assignee_session_id: null },
      after: (version: number) =>
        emit(
          { type: "task.claim_ended", id: task.id, version, from: holder, reason: "human_change" },
          { workspaceId, projectId: task.projectId },
        ).pipe(Effect.asVoid),
    }
  }

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
    return yield* commands.write({ commandId: input.commandId, rpc: "task.update" }, (context) =>
      Effect.gen(function* () {
        const { now, emit } = context
        const current = yield* load(input.id)
        yield* checkVersion(current, input.expectedVersion, context.caller)
        const fields = (Object.keys(next) as Editable[]).filter((f) => next[f] !== current[f])
        if (fields.length === 0) return current
        if (fields.includes("parentId") && next.parentId != null) {
          yield* requireParent(current.projectId, current.id, next.parentId)
        }
        const before = Object.fromEntries(fields.map((f) => [f, current[f]]))
        const after = Object.fromEntries(fields.map((f) => [f, next[f]]))
        const workspaceId = yield* workspaceOf(current.projectId)
        const claim = humanEndsClaim(current, workspaceId, context)
        yield* bump(current, now, { ...Object.fromEntries(fields.map((f) => [EDITABLE[f], next[f]])), ...claim.columns })
        yield* emit(
          { type: "task.updated", id: current.id, before, after, version: current.version + 1 },
          { workspaceId, projectId: current.projectId },
        )
        yield* claim.after(current.version + 1)
        return yield* load(current.id)
      }))
  })

  const move = Effect.fn("TaskService.move")(function* (input: MoveTask) {
    return yield* commands.write({ commandId: input.commandId, rpc: "task.move" }, (context) =>
      Effect.gen(function* () {
        const { now, emit } = context
        const current = yield* load(input.id)
        yield* checkVersion(current, input.expectedVersion, context.caller)
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
        const claim = humanEndsClaim(current, workspaceId, context)
        yield* bump(current, now, { status_id: input.statusId, position, ...claim.columns })
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
        yield* claim.after(task.version)
        return task
      }))
  })

  const setLabels = Effect.fn("TaskService.setLabels")(function* (input: SetTaskLabels) {
    if (input.add.some((id) => input.remove.includes(id))) {
      return yield* new Invalid({ field: "add", reason: "a label can't be added and removed at once" })
    }
    return yield* commands.write({ commandId: input.commandId, rpc: "task.setLabels" }, (context) =>
      Effect.gen(function* () {
        const { now, emit } = context
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
        const claim = humanEndsClaim(current, workspaceId, context)
        yield* bump(current, now, claim.columns)
        yield* emit(
          { type: "task.labels_changed", id: current.id, added, removed, version: current.version + 1 },
          { workspaceId, projectId: current.projectId },
        )
        yield* claim.after(current.version + 1)
        return yield* load(current.id)
      }))
  })

  const setArchived = (rpc: "task.archive" | "task.unarchive", archived: boolean) =>
    Effect.fn(`TaskService.${archived ? "archive" : "unarchive"}`)(function* (input: ById) {
      return yield* commands.write({ commandId: input.commandId, rpc }, (context) =>
        Effect.gen(function* () {
          const { now, emit } = context
          const current = yield* load(input.id)
          if ((current.archivedAt !== null) === archived) return current
          const workspaceId = yield* workspaceOf(current.projectId)
          const claim = humanEndsClaim(current, workspaceId, context)
          yield* bump(current, now, { archived_at: archived ? now : null, ...claim.columns })
          yield* emit(
            { type: archived ? "task.archived" : "task.unarchived", id: current.id, version: current.version + 1 },
            { workspaceId, projectId: current.projectId },
          )
          yield* claim.after(current.version + 1)
          return yield* load(current.id)
        }))
    })

  const history = Effect.fn("TaskService.history")(function* (id: string) {
    yield* load(id).pipe(Effect.catchTag("SqlError", Effect.die))
    return yield* store.history(id)
  })

  const byKey = Effect.fn("TaskService.byKey")(function* (key: string) {
    return yield* loadByKey(key)
  }, Effect.catchTag("SqlError", Effect.die))

  /** Fails with TaskClaimed if someone else holds a live claim; otherwise says why a claim is taken over. */
  const checkClaim = (task: Task, caller: Caller["Service"], now: number) =>
    Effect.gen(function* () {
      const holder = holderOf(task)
      if (holder === null) return null
      if (holder.actorId === caller.actorId && holder.sessionId === caller.sessionId) return null
      if (caller.sessionId === null) return { holder, reason: "human" as const }
      if (FINISHED.has(yield* categoryOf(task.statusId))) return null
      if (holder.sessionId === null) {
        return yield* new TaskClaimed({ key: task.key, holder: human.name, sessionId: null, lastSeenAt: null })
      }
      const [session] = yield* sessions.byIds([holder.sessionId])
      const gone = session ? isGone(session, now) : "holder_exited"
      if (!gone) {
        return yield* new TaskClaimed({
          key: task.key,
          holder: session!.clientName,
          sessionId: session!.externalId,
          lastSeenAt: session!.lastSeenAt,
        })
      }
      return { holder, reason: gone }
    })

  const claim = Effect.fn("TaskService.claim")(function* (input: ByKey) {
    return yield* commands.write({ commandId: input.commandId, rpc: "task.claim" }, ({ now, caller, emit }) =>
      Effect.gen(function* () {
        const current = yield* loadByKey(input.key)
        const workspaceId = yield* workspaceOf(current.projectId)
        const taken = yield* checkClaim(current, caller, now)
        const started = (yield* categoryOf(current.statusId)) === "started"
        const statusId = started ? current.statusId : (yield* firstStarted(workspaceId))
        const holder = holderOf(current)
        const mine = holder !== null && holder.actorId === caller.actorId && holder.sessionId === caller.sessionId
        if (mine && statusId === current.statusId) return current
        const { position } = statusId === current.statusId
          ? { position: current.position }
          : yield* placed(place(yield* column(current.projectId, statusId), {})).pipe(Effect.orDie) // no neighbors: can't fail
        yield* bump(current, now, {
          assignee_actor_id: caller.actorId,
          assignee_session_id: caller.sessionId,
          status_id: statusId,
          position,
        })
        const task = yield* load(current.id)
        const where = { workspaceId, projectId: task.projectId }
        yield* emit(
          taken
            ? { type: "task.claim_taken", id: task.id, version: task.version, task, from: taken.holder, reason: taken.reason }
            : { type: "task.claimed", id: task.id, version: task.version, task },
          where,
        )
        return task
      }))
  })

  const release = Effect.fn("TaskService.release")(function* (input: ByKey) {
    return yield* commands.write({ commandId: input.commandId, rpc: "task.release" }, ({ now, caller, emit }) =>
      Effect.gen(function* () {
        const current = yield* loadByKey(input.key)
        const holder = holderOf(current)
        if (holder === null) return yield* new Invalid({ field: "key", reason: `${current.key} isn't claimed` })
        const mine = holder.actorId === caller.actorId && holder.sessionId === caller.sessionId
        if (!mine && caller.sessionId !== null) {
          return yield* new Invalid({ field: "key", reason: `${current.key} is claimed by another session` })
        }
        yield* bump(current, now, { assignee_actor_id: null, assignee_session_id: null })
        const task = yield* load(current.id)
        yield* emit(
          { type: "task.released", id: task.id, version: task.version, task },
          { workspaceId: yield* workspaceOf(task.projectId), projectId: task.projectId },
        )
        return task
      }))
  })

  return TaskService.of({
    byKey,
    claim,
    release,
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
