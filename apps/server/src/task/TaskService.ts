// Tasks: numbered per project, ordered within (project, status), versioned on every change.
import type { CelloEvent } from "@cello/contract/events"
import type { Ask, ClaimEndCause, Priority, Task } from "@cello/contract/entities"
import { AskRequired, Invalid, NotFound, ReviewRequired, TaskClaimed, VersionConflict } from "@cello/contract/errors"
import type { TaskStage } from "@cello/contract/stages"
import type { Caller } from "@cello/contract/rpcs"
import { isNeedsInputStatus } from "@cello/shared/ask"
import { claimKeepsStatus } from "@cello/shared/claim"
import { holdsPacket, isReviewStatus } from "@cello/shared/review"
import { parseTaskKey } from "@cello/shared/taskKey"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import { withdrawOpenAsk } from "../ask/openAsk.ts"
import * as Commands from "../commands/Commands.ts"
import * as EventStore from "../events/EventStore.ts"
import * as InboxService from "../inbox/InboxService.ts"
import { newId } from "../persistence/ids.ts"
import { selectTasks } from "../persistence/rows.ts"
import * as Seed from "../persistence/Seed.ts"
import { withdrawOpenReview } from "../review/openReview.ts"
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

export interface SetStage {
  readonly commandId: string
  readonly key: string
  readonly stage: TaskStage | null
}

type ById = { readonly commandId: string; readonly id: string }
type ByKey = { readonly commandId: string; readonly key: string }
type Write<E> = Effect.Effect<Commands.Written<Task>, E, Caller>

interface MoveWithin {
  readonly id: string
  readonly statusId: string
  readonly keepClaim?: boolean
  readonly keepPacket?: boolean
  /**
   * `false`: a human's move that ends the claim tells the session nothing (an approval: its work is
   * done). Otherwise the session hears the move ended its claim (CEL-46).
   */
  readonly tell?: boolean
}

export class TaskService extends Context.Service<TaskService, {
  readonly create: (input: CreateTask) => Write<NotFound | Invalid>
  readonly update: (input: UpdateTask) => Write<NotFound | Invalid | VersionConflict>
  /**
   * An agent can't move a task into In Review unless it has an open review (`ReviewRequired`); no one moves
   * one into Needs input (`AskRequired`). Moving a task out of Needs input withdraws its open ask, and
   * moving it anywhere but In Review or Needs input withdraws its open review packet (CEL-71). A human
   * move to another status ends an agent's claim and tells its session (CEL-46); reordering within the
   * column keeps the claim.
   */
  readonly move: (input: MoveTask) => Write<NotFound | Invalid | VersionConflict | ReviewRequired | AskRequired>
  readonly setLabels: (input: SetTaskLabels) => Write<NotFound | Invalid>
  readonly archive: (input: ById) => Write<NotFound>
  readonly unarchive: (input: ById) => Write<NotFound>
  readonly history: (id: string) => Effect.Effect<ReadonlyArray<CelloEvent>, NotFound>
  /** A task by its key ("CEL-3"), archived ones included. */
  readonly byKey: (key: string) => Effect.Effect<Task, NotFound>
  /**
   * Assigns the task to the caller's session and moves it to the first started status (unless it's
   * already in one). Fails with TaskClaimed while another live session holds it; a gone holder's
   * claim is taken over (`task.claim_taken`). The human always wins, and the session he took it from hears so (CEL-46).
   */
  readonly claim: (input: ByKey) => Write<NotFound | TaskClaimed>
  /** Gives up the caller's claim; the human can release anyone's, and that session hears so (CEL-46). The status stays. */
  readonly release: (input: ByKey) => Write<NotFound | Invalid>
  /**
   * Where the task is inside In Progress (CEL-35); null clears it. Only the session holding the claim,
   * or the human, and only while the task is in the stage status (In Progress). Moving the task to
   * another status clears it, except to Needs input and back (an ask pauses the work, CEL-47).
   */
  readonly setStage: (input: SetStage) => Write<NotFound | Invalid>
  /**
   * For another service's command: moves a task to the top of a status inside that command's
   * transaction, with the same events as `move`. A human move ends an agent's claim unless `keepClaim`.
   * `keepPacket`: the command just submitted the task's open packet (review.submit), so it moves with it.
   */
  readonly moveWithin: (
    context: Commands.WriteContext,
    input: MoveWithin,
  ) => Effect.Effect<Task, NotFound | Invalid | SqlError>
  /**
   * For another service's command: activity on a task that isn't a change to its fields (a comment
   * added, edited or deleted). Records the caller and the time as its last change, with a new version,
   * inside that command's transaction. No task event (the command's own event is the change), and it
   * never ends a claim: Lucas commenting on an agent's task isn't him taking it over. Returns the task as it is now.
   */
  readonly touchWithin: (context: Commands.WriteContext, taskId: string) => Effect.Effect<Task, NotFound | SqlError>
  /**
   * For the command that adds the human's comment (CEL-110): when nobody holds the task, it goes back to
   * the agent session that last held its claim, inside that command's transaction. The task moves to the
   * top of the first started status (In Progress), as `moveWithin` does, unless work on it is still going
   * on or waiting on the human there (a started status such as In Review, or Needs input); that session
   * holds the claim again, and `task.reopened` says so. Returns who got it and the statuses before and
   * after, for the comment's inbox item. Null, changing nothing, for an agent's comment, a task someone
   * holds (an agent or the human), an archived one, or one no agent ever held.
   */
  readonly reopenWithin: (context: Commands.WriteContext, taskId: string) => Effect.Effect<Reopened | null, NotFound | Invalid | SqlError>
}>()("cello/TaskService") {}

/** A task a comment gave back to its last agent session (CEL-110), and the statuses it went from and to. */
export interface Reopened extends InboxService.Reopened {
  readonly sessionId: string
}

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
  const inbox = yield* InboxService.InboxService
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

  /** Live labels of the task's own project (CEL-80): another project's label is refused, not just missing. */
  const requireLabels = (projectId: string, labelIds: ReadonlyArray<string>) =>
    Effect.forEach(labelIds, (id) =>
      sql<{ project_id: string; name: string; label_key: string; task_key: string }>`
        SELECT l.project_id, l.name, lp.key AS label_key, tp.key AS task_key
        FROM labels l JOIN projects lp ON lp.id = l.project_id JOIN projects tp ON tp.id = ${projectId}
        WHERE l.id = ${id} AND l.archived_at IS NULL`.pipe(
        Effect.flatMap(([label]): Effect.Effect<void, NotFound | Invalid> => {
          if (!label) return Effect.fail(new NotFound({ entity: "label", id }))
          if (label.project_id === projectId) return Effect.void
          return Effect.fail(new Invalid({
            field: "labels",
            reason: `"${label.name}" is a label of ${label.label_key}, not ${label.task_key}: each project has its own labels`,
          }))
        }),
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

  /** Writes changed columns, bumps the version and records who changed it: every task change goes through here. */
  const bump = (task: Task, { now, caller }: Pick<Commands.WriteContext, "now" | "caller">, columns: Record<string, unknown>) =>
    sql`UPDATE tasks SET ${sql.update({
      ...columns,
      version: task.version + 1,
      updated_at: now,
      updated_by_actor_id: caller.actorId,
      updated_by_session_id: caller.sessionId,
      updated_by_agent_id: caller.agentId ?? null,
    })} WHERE id = ${task.id}`

  /** Who holds the task's claim, if anyone. */
  const holderOf = (task: Task) =>
    task.assigneeActorId === null ? null : { actorId: task.assigneeActorId, sessionId: task.assigneeSessionId }

  const statusOf = (statusId: string) =>
    sql<{ name: string; category: string }>`SELECT name, category FROM statuses WHERE id = ${statusId}`.pipe(Effect.map((rows) => rows[0]!))

  const categoryOf = (statusId: string) => Effect.map(statusOf(statusId), (s) => s.category)

  /** Whether a stage survives a move: both ends are In Progress (the stage status) or Needs input. */
  const stageCarries = (workspaceId: string, from: string, to: string) =>
    Effect.gen(function* () {
      const stageStatusId = yield* firstStarted(workspaceId)
      const holds = (statusId: string) =>
        statusId === stageStatusId ? Effect.succeed(true) : Effect.map(statusOf(statusId), isNeedsInputStatus)
      return (yield* holds(from)) && (yield* holds(to))
    })

  /**
   * A human change ends an agent's claim. Returns the columns that clear it (merged into the change's
   * own `bump`) and `after(version)`, which emits `task.claim_ended` once the change's event is out and
   * tells the session that held it what he did (`cause`, CEL-46). `tell: false` when the session hears
   * it another way in the same command (its withdrawn ask says the claim ended).
   */
  const humanEndsClaim = (task: Task, workspaceId: string, context: Commands.WriteContext, cause: ClaimEndCause, tell = true) => {
    const holder = holderOf(task)
    if (context.caller.sessionId !== null || holder === null || holder.sessionId === null) {
      return { columns: {}, after: (_version: number) => Effect.void }
    }
    const sessionId = holder.sessionId
    return {
      columns: { assignee_actor_id: null, assignee_session_id: null },
      after: (version: number) =>
        Effect.gen(function* () {
          yield* context.emit(
            { type: "task.claim_ended", id: task.id, version, from: holder, reason: "human_change" },
            { workspaceId, projectId: task.projectId },
          )
          if (tell) yield* inbox.deliverClaimEndedWithin(context, { taskId: task.id, sessionId, cause })
        }),
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
        yield* requireLabels(input.projectId, labelIds)
        const parentId = input.parentId ?? null
        if (parentId !== null) yield* requireParent(input.projectId, null, parentId)
        const { position } = yield* placed(place(yield* column(input.projectId, statusId), input))

        const numbers = yield* sql<{ number: number }>`
          UPDATE projects SET next_task_number = next_task_number + 1 WHERE id = ${input.projectId}
          RETURNING next_task_number - 1 AS number`
        const id = newId(now)
        yield* sql`INSERT INTO tasks (id, project_id, number, title, description, status_id, priority, position, due_date,
                                      parent_id, created_by_actor_id, created_by_session_id, updated_by_actor_id,
                                      updated_by_session_id, updated_by_agent_id, version, created_at, updated_at)
          VALUES (${id}, ${input.projectId}, ${numbers[0]!.number}, ${title}, ${input.description ?? ""}, ${statusId},
                  ${input.priority ?? 0}, ${position}, ${input.dueDate ?? null}, ${parentId}, ${caller.actorId},
                  ${caller.sessionId}, ${caller.actorId}, ${caller.sessionId}, ${caller.agentId ?? null}, 1, ${now}, ${now})`
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
        const claim = humanEndsClaim(current, workspaceId, context, "edited")
        yield* bump(current, context, { ...Object.fromEntries(fields.map((f) => [EDITABLE[f], next[f]])), ...claim.columns })
        yield* emit(
          { type: "task.updated", id: current.id, before, after, version: current.version + 1 },
          { workspaceId, projectId: current.projectId },
        )
        yield* claim.after(current.version + 1)
        return yield* load(current.id)
      }))
  })

  /** Moves `current` inside the running command: every move, from any service, goes through here. */
  const moveIn = (
    context: Commands.WriteContext,
    current: Task,
    to: Neighbors & { readonly statusId: string; readonly keepClaim?: boolean; readonly keepPacket?: boolean; readonly tell?: boolean },
  ) =>
    Effect.gen(function* () {
      const workspaceId = yield* workspaceOf(current.projectId)
      yield* requireStatus(workspaceId, to.statusId)
      const sameColumn = to.statusId === current.statusId
      const { position, unchanged } = yield* placed(
        place(yield* column(current.projectId, to.statusId), {
          self: sameColumn ? current : undefined,
          before: to.before,
          after: to.after,
        }),
      )
      if (sameColumn && unchanged) return current
      // Leaving Needs input any other way than an answer or a withdrawal (those close the ask first):
      // the open ask goes with it.
      let withdrawn: Ask | null = null
      if (!sameColumn && isNeedsInputStatus(yield* statusOf(current.statusId))) {
        withdrawn = yield* withdrawOpenAsk(sql, context, current, { workspaceId, projectId: current.projectId }, "moved")
        // Lucas moving it himself: the agent that asked hears where the card went.
        if (withdrawn !== null) yield* inbox.deliverWithdrawalWithin(context, withdrawn, (yield* statusOf(to.statusId)).name)
      }
      // An open packet waits on Lucas in In Review, or in Needs input when the agent asked from there
      // (CEL-47). Approve and Send back close it before they move the task; any other move to another
      // status withdraws it (CEL-71), so the Review page never lists a task that has moved on. So does
      // any move of a task holding a stale one (left open out of In Review before CEL-71), unless this
      // command just submitted it.
      if (!sameColumn) {
        const stale = !to.keepPacket && !holdsPacket(yield* statusOf(current.statusId))
        if (stale || !holdsPacket(yield* statusOf(to.statusId))) {
          yield* withdrawOpenReview(sql, context, current, { workspaceId, projectId: current.projectId }, to.statusId)
        }
      }
      // Reordering within the column isn't taking the task over: the claim stays. The session whose ask
      // the move withdrew hears the claim ended from it, not a second time; an approval tells no one
      // (the work is done) (CEL-46).
      const claim = to.keepClaim || sameColumn
        ? { columns: {}, after: (_version: number) => Effect.void }
        : humanEndsClaim(current, workspaceId, context, "moved", to.tell !== false && withdrawn?.sessionId !== current.assigneeSessionId)
      // A stage says where the task is inside In Progress (CEL-35): leaving the column ends it, except a
      // round trip through Needs input, where asking Lucas pauses the work without changing its step.
      const stage = sameColumn || current.stage === null || (yield* stageCarries(workspaceId, current.statusId, to.statusId))
        ? {}
        : { stage: null }
      yield* bump(current, context, { status_id: to.statusId, position, ...stage, ...claim.columns })
      const task = yield* load(current.id)
      yield* context.emit(
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
    })

  /**
   * An agent needs an open review packet to put a task in In Review (`cello task submit`). No one, agent
   * or human, puts one in Needs input by hand: an agent's `cello task ask` does that, with its questions.
   */
  const checkGates = (current: Task, statusId: string, caller: Caller["Service"]) =>
    Effect.gen(function* () {
      if (statusId === current.statusId) return
      const [status] = yield* sql<{ name: string; category: string }>`SELECT name, category FROM statuses WHERE id = ${statusId}`
      if (!status) return
      // Only an ask puts a task in Needs input, for anyone: a card there with nothing to answer would be stuck.
      if (isNeedsInputStatus(status)) return yield* new AskRequired({ key: current.key, status: status.name })
      if (caller.sessionId === null) return
      if (!isReviewStatus(status.name)) return
      // Only a packet waiting on Lucas counts: one left open on a task that moved on (before CEL-71) is stale.
      const open = yield* sql<{ id: string }>`SELECT id FROM reviews WHERE task_id = ${current.id} AND decided_at IS NULL LIMIT 1`
      if (open.length === 0 || !holdsPacket(yield* statusOf(current.statusId))) {
        return yield* new ReviewRequired({ key: current.key, status: status.name })
      }
    })

  const move = Effect.fn("TaskService.move")(function* (input: MoveTask) {
    return yield* commands.write({ commandId: input.commandId, rpc: "task.move" }, (context) =>
      Effect.gen(function* () {
        const current = yield* load(input.id)
        yield* checkVersion(current, input.expectedVersion, context.caller)
        yield* checkGates(current, input.statusId, context.caller)
        return yield* moveIn(context, current, input)
      }))
  })

  const moveWithin = (context: Commands.WriteContext, input: MoveWithin) =>
    Effect.gen(function* () {
      const current = yield* load(input.id)
      if (current.statusId === input.statusId) return current
      // The top of the column, where the human looks first.
      const top = (yield* column(current.projectId, input.statusId)).reduce<{ id: string; position: string } | null>(
        (min, t) => (min === null || t.position < min.position ? t : min),
        null,
      )
      return yield* moveIn(context, current, {
        statusId: input.statusId,
        after: top?.id ?? null,
        keepClaim: input.keepClaim ?? false,
        keepPacket: input.keepPacket ?? false,
        ...(input.tell === undefined ? {} : { tell: input.tell }),
      })
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
        yield* requireLabels(current.projectId, added)
        yield* Effect.forEach(added, (labelId) =>
          sql`INSERT INTO task_labels (task_id, label_id, created_at) VALUES (${current.id}, ${labelId}, ${now})`, {
          discard: true,
        })
        yield* Effect.forEach(removed, (labelId) =>
          sql`DELETE FROM task_labels WHERE task_id = ${current.id} AND label_id = ${labelId}`, { discard: true })
        const claim = humanEndsClaim(current, workspaceId, context, "labels")
        yield* bump(current, context, claim.columns)
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
          // Unarchiving rarely finds a claim (archiving ended it); one taken on the archived task ends as an edit.
          const claim = humanEndsClaim(current, workspaceId, context, archived ? "archived" : "edited")
          yield* bump(current, context, { archived_at: archived ? now : null, ...claim.columns })
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
    return yield* commands.write({ commandId: input.commandId, rpc: "task.claim" }, (context) =>
      Effect.gen(function* () {
        const { now, caller, emit } = context
        const current = yield* loadByKey(input.key)
        const workspaceId = yield* workspaceOf(current.projectId)
        const taken = yield* checkClaim(current, caller, now)
        // Needs input counts as started: a claim (a resumed session, a takeover) leaves the ask waiting.
        const started = claimKeepsStatus(yield* categoryOf(current.statusId))
        const statusId = started ? current.statusId : (yield* firstStarted(workspaceId))
        const holder = holderOf(current)
        const mine = holder !== null && holder.actorId === caller.actorId && holder.sessionId === caller.sessionId
        if (mine && statusId === current.statusId) return current
        const { position } = statusId === current.statusId
          ? { position: current.position }
          : yield* placed(place(yield* column(current.projectId, statusId), {})).pipe(Effect.orDie) // no neighbors: can't fail
        yield* bump(current, context, {
          assignee_actor_id: caller.actorId,
          assignee_session_id: caller.sessionId,
          // The agent that last held it, for a comment after its claim ends (CEL-110); the human's claim leaves it.
          ...(caller.sessionId === null ? {} : { last_holder_session_id: caller.sessionId }),
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
        // Lucas taking it over: the session that held it hears so (CEL-46).
        if (taken?.reason === "human" && taken.holder.sessionId !== null) {
          yield* inbox.deliverClaimEndedWithin(context, { taskId: task.id, sessionId: taken.holder.sessionId, cause: "claimed" })
        }
        return task
      }))
  })

  const release = Effect.fn("TaskService.release")(function* (input: ByKey) {
    return yield* commands.write({ commandId: input.commandId, rpc: "task.release" }, (context) =>
      Effect.gen(function* () {
        const { caller, emit } = context
        const current = yield* loadByKey(input.key)
        const holder = holderOf(current)
        if (holder === null) return yield* new Invalid({ field: "key", reason: `${current.key} isn't claimed` })
        const mine = holder.actorId === caller.actorId && holder.sessionId === caller.sessionId
        if (!mine && caller.sessionId !== null) {
          return yield* new Invalid({ field: "key", reason: `${current.key} is claimed by another session` })
        }
        yield* bump(current, context, { assignee_actor_id: null, assignee_session_id: null })
        const task = yield* load(current.id)
        yield* emit(
          { type: "task.released", id: task.id, version: task.version, task },
          { workspaceId: yield* workspaceOf(task.projectId), projectId: task.projectId },
        )
        // Lucas letting go of a session's claim: that session hears so (CEL-46).
        if (!mine && holder.sessionId !== null) {
          yield* inbox.deliverClaimEndedWithin(context, { taskId: task.id, sessionId: holder.sessionId, cause: "released" })
        }
        return task
      }))
  })

  const setStage = Effect.fn("TaskService.setStage")(function* (input: SetStage) {
    return yield* commands.write({ commandId: input.commandId, rpc: "task.stage" }, (context) =>
      Effect.gen(function* () {
        const { caller, emit } = context
        const current = yield* loadByKey(input.key)
        // The session holding the claim says where its work is; the human may too (and keeps the claim).
        if (caller.sessionId !== null) {
          const holder = holderOf(current)
          if (holder === null) {
            return yield* new Invalid({ field: "key", reason: `${current.key} isn't claimed: claim it first (\`cello task claim ${current.key}\`)` })
          }
          if (holder.actorId !== caller.actorId || holder.sessionId !== caller.sessionId) {
            return yield* new Invalid({ field: "key", reason: `${current.key} is claimed by another session: only the session holding the claim sets its stage` })
          }
        }
        const workspaceId = yield* workspaceOf(current.projectId)
        const stageStatusId = yield* firstStarted(workspaceId)
        if (current.statusId !== stageStatusId) {
          const names = yield* sql<{ id: string; name: string }>`SELECT id, name FROM statuses WHERE id IN (${current.statusId}, ${stageStatusId})`
          const name = (id: string) => names.find((n) => n.id === id)?.name ?? "another status"
          return yield* new Invalid({
            field: "stage",
            reason: `${current.key} is in ${name(current.statusId)}; a stage is only for tasks in ${name(stageStatusId)}`,
          })
        }
        if (current.stage === input.stage) return current
        yield* bump(current, context, { stage: input.stage })
        yield* emit(
          { type: "task.stage_changed", id: current.id, version: current.version + 1, before: current.stage, after: input.stage },
          { workspaceId, projectId: current.projectId },
        )
        return yield* load(current.id)
      }))
  })

  const touchWithin = (context: Commands.WriteContext, taskId: string) =>
    Effect.flatMap(load(taskId), (current) => Effect.andThen(bump(current, context, {}), load(taskId)))

  const reopenWithin = (context: Commands.WriteContext, taskId: string) =>
    Effect.gen(function* () {
      if (context.caller.sessionId !== null) return null
      const current = yield* load(taskId)
      const sessionId = current.lastHolderSessionId ?? null
      if (sessionId === null || current.assigneeActorId !== null || current.archivedAt !== null) return null
      const [session] = yield* sql<{ actor_id: string }>`SELECT actor_id FROM agent_sessions WHERE id = ${sessionId}`
      if (!session) return null
      const workspaceId = yield* workspaceOf(current.projectId)
      const from = yield* statusOf(current.statusId)
      // Where a claim leaves a task: a finished or not-started one goes back to In Progress.
      const placed = claimKeepsStatus(from.category) ? current : yield* moveWithin(context, { id: current.id, statusId: yield* firstStarted(workspaceId) })
      yield* bump(placed, context, { assignee_actor_id: session.actor_id, assignee_session_id: sessionId })
      const task = yield* load(current.id)
      yield* context.emit(
        { type: "task.reopened", id: task.id, version: task.version, task, from: current.statusId, session: sessionId },
        { workspaceId, projectId: task.projectId },
      )
      return { sessionId, from: from.name, to: (yield* statusOf(task.statusId)).name } satisfies Reopened
    })

  return TaskService.of({
    touchWithin,
    reopenWithin,
    setStage,
    byKey,
    claim,
    release,
    create,
    update,
    move,
    moveWithin,
    setLabels,
    archive: setArchived("task.archive", true),
    unarchive: setArchived("task.unarchive", false),
    history,
  })
})

export const layer = Layer.effect(TaskService, make)
