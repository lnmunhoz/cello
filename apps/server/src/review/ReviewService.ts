// Review packets: what an agent hands Lucas when it moves a task to In Review. Submit copies the
// evidence into the data folder and moves the task in one command; only the human approves (to the
// first completed status) or sends back (to the first started status, with the note as a comment that
// lands in the agent session's inbox). Any other way out of In Review withdraws the packet: TaskService
// does that inside the move (openReview.ts, CEL-71).
import * as path from "node:path"
import type { Review, Task } from "@cello/contract/entities"
import { HumanOnly, Invalid, NotFound } from "@cello/contract/errors"
import type { Caller, EvidenceFile, EvidenceLink } from "@cello/contract/rpcs"
import { approveTarget, holdsPacket, isReviewStatus, reviewTarget, sendBackTarget } from "@cello/shared/review"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import * as CommentService from "../comment/CommentService.ts"
import * as Commands from "../commands/Commands.ts"
import * as InboxService from "../inbox/InboxService.ts"
import { newId } from "../persistence/ids.ts"
import { selectReviews, selectStatuses } from "../persistence/rows.ts"
import * as Seed from "../persistence/Seed.ts"
import * as TaskService from "../task/TaskService.ts"
import { requireText } from "../validation.ts"
import * as AssetStore from "./AssetStore.ts"
import { checkFile, requireLink } from "./evidence.ts"
import * as openReview from "./openReview.ts"

export interface SubmitReview {
  readonly commandId: string
  readonly key: string
  readonly summary: string
  readonly steps: ReadonlyArray<string>
  readonly files: ReadonlyArray<EvidenceFile>
  readonly links: ReadonlyArray<EvidenceLink>
}

export interface DecideReview {
  readonly commandId: string
  readonly key: string
  readonly note?: string
  /**
   * Screenshots pasted into the Review page's box with the decision (CEL-73): they go in a comment with
   * the note (Send back's note is always one; Approve's becomes one only when screenshots come with it).
   */
  readonly attachmentIds?: ReadonlyArray<string> | undefined
}

export interface SendBack extends DecideReview {
  readonly note: string
}

/** A stored file to send: an attachment itself, or its video's poster. */
export interface StoredFile {
  readonly path: string
  readonly mime: string
  readonly bytes: number
}

type Write<A, E> = Effect.Effect<Commands.Written<A>, E, Caller>

export class ReviewService extends Context.Service<ReviewService, {
  readonly submit: (input: SubmitReview) => Write<{ readonly review: Review; readonly task: Task }, NotFound | Invalid>
  /**
   * With `attachmentIds`, the screenshots and the note go in a comment first (delivered like any comment),
   * and the approval carries no note; otherwise the note is the approval's own.
   */
  readonly approve: (input: DecideReview) => Write<Task, NotFound | Invalid | HumanOnly>
  /** `attachmentIds`: screenshots pasted with the note (the Review page's comment box, CEL-73); they go with its comment. */
  readonly sendBack: (input: SendBack) => Write<Task, NotFound | Invalid | HumanOnly>
  /** Every review of a task, oldest first. */
  readonly list: (taskId: string) => Effect.Effect<ReadonlyArray<Review>, NotFound>
  /** The file behind an attachment (or its poster), for GET /attachments/<id>. Links and deleted files are NotFound. */
  readonly file: (attachmentId: string, variant: "original" | "poster") => Effect.Effect<StoredFile, NotFound>
}>()("cello/ReviewService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands
  const tasks = yield* TaskService.TaskService
  const comments = yield* CommentService.CommentService
  const inbox = yield* InboxService.InboxService
  const assets = yield* AssetStore.AssetStore
  const human = yield* Seed.HumanActor

  const statusesOf = (task: Task) =>
    sql<{ workspace_id: string }>`SELECT workspace_id FROM projects WHERE id = ${task.projectId}`.pipe(
      Effect.flatMap((rows) => selectStatuses(sql, sql`s.workspace_id = ${rows[0]!.workspace_id}`)),
    )

  const placeOf = (task: Task) =>
    sql<{ workspace_id: string }>`SELECT workspace_id FROM projects WHERE id = ${task.projectId}`.pipe(
      Effect.map((rows) => ({ workspaceId: rows[0]!.workspace_id, projectId: task.projectId })),
    )

  const openReviewOf = (taskId: string) => openReview.openReviewOf(sql, taskId)

  const submit = Effect.fn("ReviewService.submit")(function* (input: SubmitReview) {
    const summary = yield* requireText("summary", input.summary)
    const steps = input.steps.map((s) => s.trim()).filter((s) => s !== "")
    if (steps.length === 0) return yield* new Invalid({ field: "steps", reason: "add at least one step that says how to check the work" })
    if (input.files.length + input.links.length === 0) {
      return yield* new Invalid({ field: "files", reason: "attach evidence: a video, a screenshot, a test log or a link" })
    }
    const links = yield* Effect.forEach(input.links, (link) =>
      Effect.map(requireLink(link.url), (url) => ({ url, caption: link.caption?.trim() ?? "" })))
    const files = yield* Effect.forEach(input.files, (file) => checkFile(assets.sizeOf, file))
    // Posters are made before the write: ffmpeg can hang, and a write can't be interrupted (CEL-17).
    // Their temp files go when submit's scope closes, after the write has copied them in.
    const posters = yield* Effect.forEach(files, (file) => file.kind === "video" ? assets.poster(file.source) : Effect.succeed(null))

    // Files copied so far, removed again if the command fails after copying.
    const copied: string[] = []
    return yield* commands.write({ commandId: input.commandId, rpc: "review.submit" }, (context) =>
      Effect.gen(function* () {
        const { now, caller, emit } = context
        const task = yield* tasks.byKey(input.key)
        const where = yield* placeOf(task)
        const target = reviewTarget(yield* statusesOf(task), task.statusId)
        if (target === null) return yield* new Invalid({ field: "key", reason: `${task.key} has no In Review status to move to` })

        const previous = yield* openReviewOf(task.id)
        if (previous !== null) {
          yield* sql`UPDATE reviews SET decided_at = ${now}, decision = 'superseded' WHERE id = ${previous.id}`
          yield* emit({ type: "review.decided", id: previous.id, taskId: task.id, decision: "superseded", note: null }, where)
        }

        const id = newId(now)
        yield* sql`INSERT INTO reviews (id, task_id, summary, steps, actor_id, session_id, created_at)
          VALUES (${id}, ${task.id}, ${summary}, ${JSON.stringify(steps)}, ${caller.actorId}, ${caller.sessionId}, ${now})`
        for (const [i, file] of files.entries()) {
          const attachmentId = newId(now)
          const stored = yield* assets.copyIn(file.source, task.id, attachmentId)
          copied.push(stored)
          const frame = posters[i] ?? null
          const poster = frame === null ? null : yield* assets.copyIn(frame, task.id, `${attachmentId}.poster`)
          if (poster !== null) copied.push(poster)
          yield* sql`INSERT INTO attachments (id, task_id, review_id, kind, name, path, caption, mime, bytes, poster_path,
                                              actor_id, session_id, created_at)
            VALUES (${attachmentId}, ${task.id}, ${id}, ${file.kind}, ${path.basename(file.source)}, ${stored}, ${file.caption},
                    ${file.mime}, ${file.bytes}, ${poster}, ${caller.actorId}, ${caller.sessionId}, ${now})`
        }
        for (const link of links) {
          yield* sql`INSERT INTO attachments (id, task_id, review_id, kind, name, url, caption, actor_id, session_id, created_at)
            VALUES (${newId(now)}, ${task.id}, ${id}, 'link', ${link.url}, ${link.url}, ${link.caption}, ${caller.actorId},
                    ${caller.sessionId}, ${now})`
        }
        const review = (yield* openReviewOf(task.id))!
        yield* emit({ type: "review.submitted", review }, where)
        // The submitting agent keeps its claim while Lucas reviews.
        const moved = yield* tasks.moveWithin(context, { id: task.id, statusId: target.id, keepClaim: true, keepPacket: true })
        return { review, task: moved }
      })).pipe(Effect.onError(() => assets.remove(copied)))
  }, Effect.scoped)

  /** Only the human decides; the decision closes the open review and moves the task. */
  const decide = (
    input: DecideReview,
    decision: "approved" | "sent_back",
    then: (context: Commands.WriteContext, task: Task) => Effect.Effect<Task, NotFound | Invalid | SqlError>,
  ) =>
    commands.write({ commandId: input.commandId, rpc: decision === "approved" ? "review.approve" : "review.sendBack" }, (context) =>
      Effect.gen(function* () {
        if (context.caller.sessionId !== null) {
          return yield* new HumanOnly({ action: decision === "approved" ? "approve a review" : "send back a review", human: human.name })
        }
        const task = yield* tasks.byKey(input.key)
        const status = (yield* statusesOf(task)).find((s) => s.id === task.statusId)
        // A packet left open on a task that moved on (before CEL-71) isn't waiting on Lucas: not his to decide.
        const open = status !== undefined && holdsPacket(status) ? yield* openReviewOf(task.id) : null
        if (open === null) {
          if (status === undefined || !isReviewStatus(status.name)) {
            return yield* new Invalid({ field: "key", reason: `${task.key} has no open review and isn't in In Review` })
          }
        } else {
          const note = input.note?.trim() || null
          yield* sql`UPDATE reviews SET decided_at = ${context.now}, decision = ${decision}, decision_note = ${note} WHERE id = ${open.id}`
          yield* context.emit({ type: "review.decided", id: open.id, taskId: task.id, decision, note }, yield* placeOf(task))
        }
        return yield* then(context, task)
      }))

  const approve = Effect.fn("ReviewService.approve")(function* (input: DecideReview) {
    const shots = input.attachmentIds ?? []
    return yield* decide(shots.length > 0 ? { ...input, note: undefined } : input, "approved", (context, task) =>
      Effect.gen(function* () {
        const done = approveTarget(yield* statusesOf(task))
        if (done === null) return yield* new Invalid({ field: "key", reason: "this workspace has no completed status" })
        // Before the move, while the agent still holds the task: the comment reaches it.
        if (shots.length > 0) {
          const comment = yield* comments.addWithin(context, { taskId: task.id, body: input.note ?? "", attachmentIds: shots })
          yield* inbox.deliverWithin(context, comment, "comment")
        }
        return yield* tasks.moveWithin(context, { id: task.id, statusId: done.id })
      }))
  })

  const sendBack = Effect.fn("ReviewService.sendBack")(function* (input: SendBack) {
    const note = yield* requireText("note", input.note)
    return yield* decide({ ...input, note }, "sent_back", (context, task) =>
      Effect.gen(function* () {
        const started = sendBackTarget(yield* statusesOf(task))
        if (started === null) return yield* new Invalid({ field: "key", reason: "this workspace has no started status" })
        // Sent back to the same agent: its claim stays, and the note waits for it as a comment, in its inbox.
        const moved = yield* tasks.moveWithin(context, { id: task.id, statusId: started.id, keepClaim: true })
        const comment = yield* comments.addWithin(context, { taskId: task.id, body: note, attachmentIds: input.attachmentIds })
        yield* inbox.deliverWithin(context, comment, "send_back")
        return moved
      }))
  })

  const list = Effect.fn("ReviewService.list")(function* (taskId: string) {
    const found = yield* sql<{ id: string }>`SELECT id FROM tasks WHERE id = ${taskId}`
    if (found.length === 0) return yield* new NotFound({ entity: "task", id: taskId })
    return yield* selectReviews(sql, sql`r.task_id = ${taskId}`)
  }, Effect.catchTag("SqlError", Effect.die))

  const file = Effect.fn("ReviewService.file")(function* (attachmentId: string, variant: "original" | "poster") {
    const [row] = yield* sql<{ path: string | null; poster_path: string | null; mime: string | null }>`
      SELECT path, poster_path, mime FROM attachments WHERE id = ${attachmentId} AND deleted_at IS NULL`
    const relative = variant === "poster" ? row?.poster_path : row?.path
    const stored = relative ? assets.resolve(relative) : null
    const bytes = stored === null ? null : yield* assets.sizeOf(stored)
    if (!row || stored === null || bytes === null) return yield* new NotFound({ entity: "attachment", id: attachmentId })
    return { path: stored, mime: variant === "poster" ? "image/jpeg" : row.mime ?? "application/octet-stream", bytes }
  }, Effect.catchTag("SqlError", Effect.die))

  return ReviewService.of({ submit, approve, sendBack, list, file })
})

export const layer = Layer.effect(ReviewService, make)
