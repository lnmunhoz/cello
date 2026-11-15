// Comments on a task. Deleting sets `deleted_at`; nothing is hard-deleted. Adding, editing or deleting
// one is activity on its task: the task's last change becomes the commenter's, in the same transaction.
import type { Comment } from "@cello/contract/entities"
import { Invalid, NotFound } from "@cello/contract/errors"
import type { Caller } from "@cello/contract/rpcs"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import * as Commands from "../commands/Commands.ts"
import * as InboxService from "../inbox/InboxService.ts"
import { newId } from "../persistence/ids.ts"
import { selectComments } from "../persistence/rows.ts"
import { TaskService } from "../task/TaskService.ts"
import { requireText } from "../validation.ts"

export class CommentService extends Context.Service<CommentService, {
  /** The task's comments that aren't deleted, oldest first. */
  readonly list: (taskId: string) => Effect.Effect<ReadonlyArray<Comment>, NotFound>
  readonly add: (input: { readonly commandId: string; readonly taskId: string; readonly body: string }) => Effect.Effect<
    Commands.Written<Comment>,
    NotFound | Invalid,
    Caller
  >
  readonly edit: (input: { readonly commandId: string; readonly id: string; readonly body: string }) => Effect.Effect<
    Commands.Written<Comment>,
    NotFound | Invalid,
    Caller
  >
  readonly remove: (input: { readonly commandId: string; readonly id: string }) => Effect.Effect<
    Commands.Written<Comment>,
    NotFound,
    Caller
  >
  /**
   * For another service's command: adds a comment inside that command's transaction, as its caller.
   * Delivering it to an agent's inbox is up to that command (`InboxService.deliverWithin`).
   */
  readonly addWithin: (
    context: Commands.WriteContext,
    input: { readonly taskId: string; readonly body: string },
  ) => Effect.Effect<Comment, NotFound | Invalid | SqlError>
}>()("cello/CommentService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands
  const inbox = yield* InboxService.InboxService
  const tasks = yield* TaskService

  /** The task's project and workspace, which every comment event carries. */
  const placeOfTask = (taskId: string) =>
    sql<{ project_id: string; workspace_id: string }>`
      SELECT t.project_id, p.workspace_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ${taskId}`.pipe(
      Effect.flatMap((rows) =>
        rows[0]
          ? Effect.succeed({ projectId: rows[0].project_id, workspaceId: rows[0].workspace_id })
          : Effect.fail(new NotFound({ entity: "task", id: taskId }))
      ),
    )

  /** A comment that isn't deleted. */
  const load = (id: string) =>
    selectComments(sql, sql`c.id = ${id}`).pipe(
      Effect.flatMap((rows) =>
        rows[0] && rows[0].deletedAt === null
          ? Effect.succeed(rows[0])
          : Effect.fail(new NotFound({ entity: "comment", id }))
      ),
    )

  const list = Effect.fn("CommentService.list")(function* (taskId: string) {
    yield* placeOfTask(taskId)
    return yield* selectComments(sql, sql`c.task_id = ${taskId} AND c.deleted_at IS NULL`)
  }, Effect.catchTag("SqlError", Effect.die))

  const addWithin = (
    context: Commands.WriteContext,
    input: { readonly taskId: string; readonly body: string },
  ) =>
    Effect.gen(function* () {
      const { now, caller, emit } = context
      const body = yield* requireText("body", input.body)
      const where = yield* placeOfTask(input.taskId)
      const id = newId(now)
      yield* sql`INSERT INTO comments (id, task_id, body, actor_id, session_id, created_at, updated_at)
        VALUES (${id}, ${input.taskId}, ${body}, ${caller.actorId}, ${caller.sessionId}, ${now}, ${now})`
      yield* tasks.touchWithin(context, input.taskId)
      const comment = yield* load(id)
      yield* emit({ type: "comment.added", comment }, where)
      return comment
    })

  const add = Effect.fn("CommentService.add")(function* (
    input: { readonly commandId: string; readonly taskId: string; readonly body: string },
  ) {
    yield* requireText("body", input.body)
    return yield* commands.write({ commandId: input.commandId, rpc: "comment.add" }, (context) =>
      Effect.gen(function* () {
        const comment = yield* addWithin(context, input)
        // A human comment on a claimed task waits for the claiming agent session.
        yield* inbox.deliverWithin(context, comment, "comment")
        return comment
      }))
  })

  const edit = Effect.fn("CommentService.edit")(function* (
    input: { readonly commandId: string; readonly id: string; readonly body: string },
  ) {
    const body = yield* requireText("body", input.body)
    return yield* commands.write({ commandId: input.commandId, rpc: "comment.edit" }, (context) =>
      Effect.gen(function* () {
        const { now, emit } = context
        const current = yield* load(input.id)
        if (current.body === body) return current
        yield* sql`UPDATE comments SET body = ${body}, updated_at = ${now} WHERE id = ${current.id}`
        yield* tasks.touchWithin(context, current.taskId)
        yield* emit(
          { type: "comment.edited", id: current.id, taskId: current.taskId, before: { body: current.body }, after: { body } },
          yield* placeOfTask(current.taskId),
        )
        return yield* load(current.id)
      }))
  })

  const remove = Effect.fn("CommentService.remove")(function* (input: { readonly commandId: string; readonly id: string }) {
    return yield* commands.write({ commandId: input.commandId, rpc: "comment.delete" }, (context) =>
      Effect.gen(function* () {
        const { now, emit } = context
        const current = yield* load(input.id)
        yield* sql`UPDATE comments SET deleted_at = ${now}, updated_at = ${now} WHERE id = ${current.id}`
        yield* tasks.touchWithin(context, current.taskId)
        yield* emit({ type: "comment.deleted", id: current.id, taskId: current.taskId }, yield* placeOfTask(current.taskId))
        return { ...current, deletedAt: now, updatedAt: now }
      }))
  })

  return CommentService.of({ list, add, edit, remove, addWithin })
})

export const layer = Layer.effect(CommentService, make)
