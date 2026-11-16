// Comments on a task. Deleting sets `deleted_at`; nothing is hard-deleted. Adding, editing or deleting
// one is activity on its task: the task's last change becomes the commenter's, in the same transaction.
// The human's comment on a task nobody holds reopens it for the agent session that last held it (CEL-110).
// A comment can carry screenshots (CEL-73): Lucas's are uploaded while he writes (`upload`, drafts of the
// task's comment box, no event) and named by id when he sends; an agent's are image files copied in.
// Emoji reactions on a comment (CEL-77) are no activity on the task: they leave it alone, and removing
// one deletes its row (its events keep the history).
import * as path from "node:path"
import type { Attachment, Comment } from "@cello/contract/entities"
import { type HumanOnly, Invalid, NotFound } from "@cello/contract/errors"
import type { Caller, EvidenceFile } from "@cello/contract/rpcs"
import { cleanReaction, reactionProblem } from "@cello/shared/reaction"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import * as Commands from "../commands/Commands.ts"
import * as InboxService from "../inbox/InboxService.ts"
import { newId } from "../persistence/ids.ts"
import { selectComments, selectReactions } from "../persistence/rows.ts"
import * as Seed from "../persistence/Seed.ts"
import * as AssetStore from "../review/AssetStore.ts"
import { checkFile } from "../review/evidence.ts"
import { TaskService } from "../task/TaskService.ts"
import * as Drafts from "../upload/drafts.ts"
import { requireText } from "../validation.ts"

/** What a new comment says, and the screenshots it carries. */
export interface NewComment {
  readonly taskId: string
  /** Markdown; may be empty when the comment carries a screenshot. */
  readonly body: string
  /** Lucas's drafts (`upload`) of this task's comment box, in any order; they show in the order pasted. */
  readonly attachmentIds?: ReadonlyArray<string> | undefined
  /** An agent's image files: absolute paths on this machine, copied into the data folder. */
  readonly files?: ReadonlyArray<EvidenceFile> | undefined
}

export interface CommentUpload extends Drafts.Upload {
  readonly taskId: string
}

export class CommentService extends Context.Service<CommentService, {
  /** The task's comments that aren't deleted, oldest first. */
  readonly list: (taskId: string) => Effect.Effect<ReadonlyArray<Comment>, NotFound>
  readonly add: (input: NewComment & { readonly commandId: string }) => Effect.Effect<
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
   * The caller's emoji reaction on a comment (CEL-77): `on` adds it, false removes it; a no-op (no
   * event) when it's already so. One per caller (the human, or an agent session) and emoji. Not activity
   * on the task. The human's reaction to an agent's comment reaches that agent (`deliverReactionWithin`).
   */
  readonly react: (input: { readonly commandId: string; readonly commentId: string; readonly emoji: string; readonly on: boolean }) => Effect.Effect<
    Commands.Written<Comment>,
    NotFound | Invalid,
    Caller
  >
  /**
   * For another service's command: adds a comment inside that command's transaction, as its caller,
   * and delivers it to an agent's inbox as `deliver` says (`InboxService.deliverWithin`), before the
   * comment is read back, so `comment.added` carries where it went (CEL-76).
   */
  readonly addWithin: (
    context: Commands.WriteContext,
    input: NewComment,
    deliver: "comment" | "send_back",
    reopened?: InboxService.Reopened | null,
  ) => Effect.Effect<Comment, NotFound | Invalid | SqlError>
  /** Stores a screenshot Lucas pasted or dropped into a task's comment box, as a draft (human only). */
  readonly upload: (input: CommentUpload) => Effect.Effect<Attachment, NotFound | Invalid | HumanOnly, Caller>
  /** Removes drafts never sent (a comment box's a week after the upload, an ask's a day after it closed). Returns how many went. */
  readonly sweepDrafts: Effect.Effect<number>
}>()("cello/CommentService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands
  const inbox = yield* InboxService.InboxService
  const tasks = yield* TaskService
  const assets = yield* AssetStore.AssetStore
  const human = yield* Seed.HumanActor
  const drafts = Drafts.make(sql, assets, human)

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

  /** The words, or "" when there are none but a screenshot comes with them. */
  const bodyOf = (input: NewComment) =>
    (input.attachmentIds?.length ?? 0) + (input.files?.length ?? 0) > 0 ? Effect.succeed(input.body.trim()) : requireText("body", input.body)

  /** An agent's files: images only, checked before anything is written. */
  const checkImages = (files: ReadonlyArray<EvidenceFile>) =>
    Effect.forEach(files, (file) =>
      Effect.flatMap(checkFile(assets.sizeOf, file), (checked) =>
        checked.kind === "image"
          ? Effect.succeed(checked)
          : Effect.fail(new Invalid({ field: "files", reason: `${path.basename(file.path)} isn't an image (PNG, JPEG, GIF, WebP or AVIF)` }))))

  const addWithin = (
    context: Commands.WriteContext,
    input: NewComment,
    deliver: "comment" | "send_back",
    reopened: InboxService.Reopened | null = null,
  ) =>
    Effect.gen(function* () {
      const { now, caller, emit } = context
      const body = yield* bodyOf(input)
      const images = yield* checkImages(input.files ?? [])
      const where = yield* placeOfTask(input.taskId)
      // Lucas's own drafts of this task's box, each once; agents have none.
      const available = caller.sessionId !== null ? [] : (yield* sql<{ id: string }>`
        SELECT id FROM attachments WHERE task_id = ${input.taskId} AND answer_to = 'draft' AND ask_id IS NULL AND comment_id IS NULL
          AND deleted_at IS NULL AND actor_id = ${caller.actorId}`).map((d) => d.id)
      const attachmentIds = yield* drafts.take(input.attachmentIds ?? [], available, new Set(), "this task's comment box")
      const id = newId(now)
      yield* sql`INSERT INTO comments (id, task_id, body, actor_id, session_id, agent_id, created_at, updated_at)
        VALUES (${id}, ${input.taskId}, ${body}, ${caller.actorId}, ${caller.sessionId}, ${caller.agentId ?? null}, ${now}, ${now})`
      if (attachmentIds.length > 0) {
        yield* sql`UPDATE attachments SET comment_id = ${id}, answer_to = NULL WHERE ${sql.in("id", attachmentIds)}`
      }
      const copied: string[] = []
      yield* Effect.gen(function* () {
        for (const image of images) {
          const attachmentId = newId(now)
          const relative = yield* assets.copyIn(image.source, input.taskId, attachmentId)
          copied.push(relative)
          yield* sql`INSERT INTO attachments (id, task_id, comment_id, kind, name, path, caption, mime, bytes, actor_id, session_id, created_at)
            VALUES (${attachmentId}, ${input.taskId}, ${id}, 'image', ${path.basename(image.source)}, ${relative}, ${image.caption},
                    ${image.mime}, ${image.bytes}, ${caller.actorId}, ${caller.sessionId}, ${now})`
        }
      }).pipe(Effect.onError(() => assets.remove(copied)))
      yield* tasks.touchWithin(context, input.taskId)
      // A human comment on a claimed task waits for the claiming agent session.
      yield* inbox.deliverWithin(context, { id, taskId: input.taskId, createdAt: now }, deliver, reopened)
      const comment = yield* load(id)
      yield* emit({ type: "comment.added", comment }, where)
      return comment
    })

  const add = Effect.fn("CommentService.add")(function* (input: NewComment & { readonly commandId: string }) {
    yield* bodyOf(input)
    return yield* commands.write({ commandId: input.commandId, rpc: "comment.add" }, (context) =>
      Effect.gen(function* () {
        // The human writing on a task nobody holds (Done, released): it goes back to the agent that last
        // held it, and the comment with it (CEL-110). Not the comment an approval or a Send back adds.
        const reopened = yield* tasks.reopenWithin(context, input.taskId)
        return yield* addWithin(context, input, "comment", reopened)
      }))
  })

  const upload = Effect.fn("CommentService.upload")(function* (input: CommentUpload) {
    return yield* drafts.store(input, "paste screenshots into comments", Effect.gen(function* () {
      const [task] = yield* sql<{ id: string }>`SELECT id FROM tasks WHERE id = ${input.taskId}`
      if (!task) return yield* new NotFound({ entity: "task", id: input.taskId })
      return { taskId: task.id, askId: null }
    }).pipe(Effect.catchTag("SqlError", Effect.die)))
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
        // The board can't work out the latest remaining comment: the event says it.
        const { lastCommentAt } = yield* tasks.touchWithin(context, current.taskId)
        yield* emit({ type: "comment.deleted", id: current.id, taskId: current.taskId, lastCommentAt }, yield* placeOfTask(current.taskId))
        return { ...current, deletedAt: now, updatedAt: now }
      }))
  })

  const react = Effect.fn("CommentService.react")(function* (
    input: { readonly commandId: string; readonly commentId: string; readonly emoji: string; readonly on: boolean },
  ) {
    const problem = reactionProblem(input.emoji)
    if (problem !== null) return yield* new Invalid({ field: "emoji", reason: `a reaction ${problem}` })
    const emoji = cleanReaction(input.emoji)
    return yield* commands.write({ commandId: input.commandId, rpc: "comment.react" }, (context) =>
      Effect.gen(function* () {
        const { now, caller, emit } = context
        const comment = yield* load(input.commentId)
        const mine = (comment.reactions ?? []).find((r) =>
          r.emoji === emoji && r.actorId === caller.actorId && r.sessionId === caller.sessionId
        )
        if (input.on === (mine !== undefined)) return comment
        const where = yield* placeOfTask(comment.taskId)
        if (mine) {
          yield* sql`DELETE FROM comment_reactions WHERE id = ${mine.id}`
          yield* emit({ type: "reaction.removed", reaction: mine }, where)
        } else {
          const id = newId(now)
          yield* sql`INSERT INTO comment_reactions (id, comment_id, task_id, emoji, actor_id, session_id, agent_id, created_at)
            VALUES (${id}, ${comment.id}, ${comment.taskId}, ${emoji}, ${caller.actorId}, ${caller.sessionId}, ${caller.agentId ?? null}, ${now})`
          const [reaction] = yield* selectReactions(sql, sql`r.id = ${id}`)
          yield* inbox.deliverReactionWithin(context, comment, reaction!)
          yield* emit({ type: "reaction.added", reaction: reaction! }, where)
        }
        return yield* load(comment.id)
      }))
  })

  return CommentService.of({ list, add, edit, remove, react, addWithin, upload, sweepDrafts: drafts.sweep })
})

export const layer = Layer.effect(CommentService, make)
