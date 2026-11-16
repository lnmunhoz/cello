// Needs input (CEL-47): an agent asks Lucas questions on a task, with options and evidence, and waits.
// Asking copies the evidence into the data folder and moves the task to Needs input in one command;
// asking again replaces the open ask. Only the human answers: the task goes back to In Progress with
// its claim, and the answers wait in the agent session's inbox (the hook hands them over) or wake a
// `cello wait`. The screenshots Lucas pastes into his answers are uploaded as he drafts (`upload`, no
// event: a draft isn't board state); sending links them to what they answer, and drafts left behind
// by an ask that closed are swept a day later.
import * as path from "node:path"
import type { Ask, Attachment, Task } from "@cello/contract/entities"
import { HumanOnly, Invalid, NotFound, TaskClaimed } from "@cello/contract/errors"
import { Caller, type AnswerInput, type AskQuestionInput, type EvidenceFile, type EvidenceLink } from "@cello/contract/rpcs"
import type { AskWaited } from "@cello/contract/views"
import { answerProblem, isNeedsInputStatus, needsInputTarget } from "@cello/shared/ask"
import { sendBackTarget } from "@cello/shared/review"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import * as EventLog from "../events/EventLog.ts"
import * as EventStore from "../events/EventStore.ts"
import * as InboxService from "../inbox/InboxService.ts"
import { newId } from "../persistence/ids.ts"
import { selectAsks, selectStatuses, selectTasks, type StoredAnswers } from "../persistence/rows.ts"
import * as Seed from "../persistence/Seed.ts"
import * as AssetStore from "../review/AssetStore.ts"
import { SessionService } from "../session/SessionService.ts"
import { checkFile, requireLink } from "../review/evidence.ts"
import * as TaskService from "../task/TaskService.ts"
import { requireText } from "../validation.ts"
import * as Drafts from "../upload/drafts.ts"
import { withdrawOpenAsk } from "./openAsk.ts"
import { checkQuestions, withImages } from "./questions.ts"

export interface CreateAsk {
  readonly commandId: string
  readonly key: string
  readonly title: string
  readonly intro?: string
  readonly questions: ReadonlyArray<AskQuestionInput>
  readonly files: ReadonlyArray<EvidenceFile>
  readonly links: ReadonlyArray<EvidenceLink>
}

export interface AnswerAsk {
  readonly commandId: string
  readonly askId: string
  readonly answers: ReadonlyArray<AnswerInput>
  readonly note?: string
  readonly noteAttachmentIds?: ReadonlyArray<string>
}

export interface Upload extends Drafts.Upload {
  readonly askId: string
}

export { DRAFT_TTL_MS, MAX_UPLOAD_BYTES, UPLOAD_TYPES } from "../upload/drafts.ts"

type Write<A, E> = Effect.Effect<Commands.Written<A>, E, Caller>
type AskAndTask = { readonly ask: Ask; readonly task: Task }

export class AskService extends Context.Service<AskService, {
  readonly create: (input: CreateAsk) => Write<AskAndTask, NotFound | Invalid | TaskClaimed>
  readonly answer: (input: AnswerAsk) => Write<AskAndTask, NotFound | Invalid | HumanOnly>
  readonly withdraw: (input: { readonly commandId: string; readonly key: string }) => Write<AskAndTask, NotFound | Invalid | TaskClaimed>
  /** The task's latest ask, open or not. */
  readonly latest: (key: string) => Effect.Effect<Ask, NotFound>
  /** Every ask of a task, oldest first. */
  readonly list: (taskId: string) => Effect.Effect<ReadonlyArray<Ask>, NotFound>
  /**
   * Waits until the task's latest ask is no longer open, then returns it (at once when it isn't) and
   * takes the caller's inbox item for its answers; `alreadyDelivered` when someone took it first
   * (InboxService.handOverAnswers). A retry with the same `commandId` gets the first call's result.
   */
  readonly wait: (key: string, commandId?: string) => Effect.Effect<AskWaited, NotFound, Caller>
  /** Stores a screenshot Lucas pasted into a draft of his answers (human only, open asks only). */
  readonly upload: (input: Upload) => Effect.Effect<Attachment, NotFound | Invalid | HumanOnly, Caller>
  /** Removes draft screenshots never sent, a day after their ask closed. Returns how many went. */
  readonly sweepDrafts: Effect.Effect<number>
}>()("cello/AskService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands
  const tasks = yield* TaskService.TaskService
  const inbox = yield* InboxService.InboxService
  const assets = yield* AssetStore.AssetStore
  const log = yield* EventLog.EventLog
  const store = yield* EventStore.EventStore
  const human = yield* Seed.HumanActor
  const sessions = yield* SessionService
  const drafts = Drafts.make(sql, assets, human)

  const placeOf = (task: Task) =>
    sql<{ workspace_id: string }>`SELECT workspace_id FROM projects WHERE id = ${task.projectId}`.pipe(
      Effect.map((rows) => ({ workspaceId: rows[0]!.workspace_id, projectId: task.projectId })),
    )

  const statusesOf = (workspaceId: string) => selectStatuses(sql, sql`s.workspace_id = ${workspaceId}`)

  const askById = (id: string) => selectAsks(sql, sql`a.id = ${id}`).pipe(Effect.map((rows) => rows[0]!))

  /** Back to the first started status (In Progress), claim kept, when the task is still in Needs input. */
  const backToWork = (context: Commands.WriteContext, task: Task, workspaceId: string) =>
    Effect.gen(function* () {
      const statuses = yield* statusesOf(workspaceId)
      const current = statuses.find((s) => s.id === task.statusId)
      const started = sendBackTarget(statuses)
      if (!current || !isNeedsInputStatus(current) || started === null) return task
      return yield* tasks.moveWithin(context, { id: task.id, statusId: started.id, keepClaim: true })
    })

  /**
   * Only the session working on a task (its claim holder) asks on it or withdraws: anyone else would
   * replace the holder's questions, and the answers would reach a session that never asked. Lucas
   * answers, and withdraws an ask by moving the card.
   */
  const requireHolder = (context: Commands.WriteContext, task: Task) =>
    Effect.gen(function* () {
      const { caller } = context
      if (caller.sessionId === null) {
        return yield* new Invalid({
          field: "key",
          reason: `questions come from the agent working on ${task.key}; ${human.name} answers them, and withdraws one by moving the card`,
        })
      }
      if (task.assigneeActorId === caller.actorId && task.assigneeSessionId === caller.sessionId) return
      if (task.assigneeActorId === null) {
        return yield* new Invalid({
          field: "key",
          reason: `claim ${task.key} first (cello task claim ${task.key}): only the session working on a task asks on it`,
        })
      }
      const [holder] = task.assigneeSessionId === null ? [] : yield* sessions.byIds([task.assigneeSessionId])
      return yield* new TaskClaimed({
        key: task.key,
        holder: holder?.clientName ?? human.name,
        sessionId: holder?.externalId ?? null,
        lastSeenAt: holder?.lastSeenAt ?? null,
      })
    })

  const create = Effect.fn("AskService.create")(function* (input: CreateAsk) {
    const title = yield* requireText("title", input.title)
    const intro = input.intro?.trim() ?? ""
    const questions = yield* checkQuestions(input.questions)
    const links = yield* Effect.forEach(input.links, (link) =>
      Effect.map(requireLink(link.url), (url) => ({ url, caption: link.caption?.trim() ?? "" })))
    // Option images are evidence too: stored once each, even when also passed as files.
    const imagePaths = questions.flatMap((q) => q.options.flatMap((o) => (o.image === null ? [] : [o.image])))
    const extra = imagePaths.filter((p, i) => imagePaths.indexOf(p) === i && !input.files.some((f) => f.path === p)).map((p) => ({ path: p }))
    const files = yield* Effect.forEach([...input.files, ...extra], (file) => checkFile(assets.sizeOf, file))
    for (const image of imagePaths) {
      const file = files.find((f) => f.source === image)!
      if (file.kind !== "image") return yield* new Invalid({ field: "questions", reason: `${path.basename(image)} isn't an image, so it can't show on an option` })
    }
    // Posters are made before the write (CEL-17); their temp files go when the scope closes.
    const posters = yield* Effect.forEach(files, (file) => file.kind === "video" ? assets.poster(file.source) : Effect.succeed(null))

    const copied: string[] = []
    return yield* commands.write({ commandId: input.commandId, rpc: "ask.create" }, (context) =>
      Effect.gen(function* () {
        const { now, caller, emit } = context
        const task = yield* tasks.byKey(input.key)
        yield* requireHolder(context, task)
        const where = yield* placeOf(task)
        const target = needsInputTarget(yield* statusesOf(where.workspaceId))
        if (target === null) return yield* new Invalid({ field: "key", reason: `${task.key}'s workspace has no Needs input status to move it to` })

        yield* withdrawOpenAsk(sql, context, task, where, "superseded")
        const id = newId(now)
        const imageIds = new Map<string, string>()
        const stored: Array<{ readonly id: string; readonly file: (typeof files)[number]; readonly relative: string; readonly poster: string | null }> = []
        for (const [i, file] of files.entries()) {
          const attachmentId = newId(now)
          const relative = yield* assets.copyIn(file.source, task.id, attachmentId)
          copied.push(relative)
          const frame = posters[i] ?? null
          const poster = frame === null ? null : yield* assets.copyIn(frame, task.id, `${attachmentId}.poster`)
          if (poster !== null) copied.push(poster)
          if (imagePaths.includes(file.source)) imageIds.set(file.source, attachmentId)
          stored.push({ id: attachmentId, file, relative, poster })
        }
        // The ask before its files: they reference it.
        yield* sql`INSERT INTO asks (id, task_id, actor_id, session_id, title, intro, questions, state, created_at)
          VALUES (${id}, ${task.id}, ${caller.actorId}, ${caller.sessionId}, ${title}, ${intro},
                  ${JSON.stringify(withImages(questions, imageIds))}, 'open', ${now})`
        for (const { id: attachmentId, file, relative, poster } of stored) {
          yield* sql`INSERT INTO attachments (id, task_id, ask_id, kind, name, path, caption, mime, bytes, poster_path, actor_id, session_id, created_at)
            VALUES (${attachmentId}, ${task.id}, ${id}, ${file.kind}, ${path.basename(file.source)}, ${relative}, ${file.caption}, ${file.mime},
                    ${file.bytes}, ${poster}, ${caller.actorId}, ${caller.sessionId}, ${now})`
        }
        for (const link of links) {
          yield* sql`INSERT INTO attachments (id, task_id, ask_id, kind, name, url, caption, actor_id, session_id, created_at)
            VALUES (${newId(now)}, ${task.id}, ${id}, 'link', ${link.url}, ${link.url}, ${link.caption}, ${caller.actorId}, ${caller.sessionId}, ${now})`
        }
        const ask = yield* askById(id)
        yield* emit({ type: "ask.created", ask }, where)
        // The asking agent keeps its claim while Lucas decides.
        const moved = yield* tasks.moveWithin(context, { id: task.id, statusId: target.id, keepClaim: true })
        return { ask, task: moved }
      })).pipe(Effect.onError(() => assets.remove(copied)))
  }, Effect.scoped)

  const answer = Effect.fn("AskService.answer")(function* (input: AnswerAsk) {
    return yield* commands.write({ commandId: input.commandId, rpc: "ask.answer" }, (context) =>
      Effect.gen(function* () {
        const { now, emit } = context
        if (context.caller.sessionId !== null) return yield* new HumanOnly({ action: "answer an ask", human: human.name })
        const [found] = yield* selectAsks(sql, sql`a.id = ${input.askId}`)
        if (!found) return yield* new NotFound({ entity: "ask", id: input.askId })
        if (found.state !== "open") return yield* new Invalid({ field: "askId", reason: `this ask is ${found.state}, so it can't be answered` })

        // Every question once, nothing else; each screenshot is a draft of this ask's, used once.
        const available = (yield* sql<{ id: string }>`
          SELECT id FROM attachments WHERE ask_id = ${found.id} AND answer_to = 'draft' AND deleted_at IS NULL`).map((d) => d.id)
        const used = new Set<string>()
        const takeScreenshots = (ids: ReadonlyArray<string>) => drafts.take(ids, available, used, "this ask's")
        const stored: Array<StoredAnswers["questions"][number] & { readonly attachmentIds: ReadonlyArray<string> }> = []
        for (const question of found.questions) {
          const given = input.answers.filter((a) => a.questionId === question.id)
          if (given.length > 1) return yield* new Invalid({ field: "answers", reason: `question ${question.id} is answered twice` })
          const entry = {
            questionId: question.id,
            optionIds: [...new Set(given[0]?.optionIds ?? [])],
            none: given[0]?.none === true,
            comment: given[0]?.comment?.trim() ?? "",
            attachmentIds: yield* takeScreenshots(given[0]?.attachmentIds ?? []),
          }
          const problem = answerProblem(question, entry)
          if (problem !== null) {
            return yield* new Invalid({
              field: "answers",
              reason: problem === "unanswered" ? `answer every question: "${question.prompt}" has no answer` : `"${question.prompt}": ${problem}`,
            })
          }
          stored.push(entry)
        }
        const stranger = input.answers.find((a) => !found.questions.some((q) => q.id === a.questionId))
        if (stranger) return yield* new Invalid({ field: "answers", reason: `this ask has no question ${stranger.questionId}` })
        const noteIds = yield* takeScreenshots(input.noteAttachmentIds ?? [])

        const answers: StoredAnswers = { questions: stored.map(({ attachmentIds: _, ...q }) => q) }
        yield* sql`UPDATE asks SET state = 'answered', answered_at = ${now}, answers = ${JSON.stringify(answers)},
                                   note = ${input.note?.trim() ?? ""} WHERE id = ${found.id}`
        for (const q of stored) {
          for (const id of q.attachmentIds) yield* sql`UPDATE attachments SET answer_to = ${q.questionId} WHERE id = ${id}`
        }
        for (const id of noteIds) yield* sql`UPDATE attachments SET answer_to = 'note' WHERE id = ${id}`

        const [task] = yield* selectTasks(sql, sql`t.id = ${found.taskId}`)
        const where = yield* placeOf(task!)
        const ask = yield* askById(found.id)
        yield* emit({ type: "ask.answered", ask }, where)
        const moved = yield* backToWork(context, task!, where.workspaceId)
        yield* inbox.deliverAnswersWithin(context, ask)
        return { ask, task: moved }
      }))
  })

  const withdraw = Effect.fn("AskService.withdraw")(function* (input: { readonly commandId: string; readonly key: string }) {
    return yield* commands.write({ commandId: input.commandId, rpc: "ask.withdraw" }, (context) =>
      Effect.gen(function* () {
        const task = yield* tasks.byKey(input.key)
        yield* requireHolder(context, task)
        const where = yield* placeOf(task)
        const ask = yield* withdrawOpenAsk(sql, context, task, where, "agent")
        if (ask === null) return yield* new Invalid({ field: "key", reason: `${task.key} has no open ask to withdraw` })
        return { ask, task: yield* backToWork(context, task, where.workspaceId) }
      }))
  })

  const latest = Effect.fn("AskService.latest")(function* (key: string) {
    const task = yield* tasks.byKey(key)
    const rows = yield* selectAsks(sql, sql`a.task_id = ${task.id}`)
    return rows.at(-1) ?? (yield* new NotFound({ entity: "ask", id: task.key }))
  }, Effect.catchTag("SqlError", Effect.die))

  const list = Effect.fn("AskService.list")(function* (taskId: string) {
    const found = yield* sql<{ id: string }>`SELECT id FROM tasks WHERE id = ${taskId}`
    if (found.length === 0) return yield* new NotFound({ entity: "task", id: taskId })
    return yield* selectAsks(sql, sql`a.task_id = ${taskId}`)
  }, Effect.catchTag("SqlError", Effect.die))

  const wait = Effect.fn("AskService.wait")(function* (key: string, commandId?: string) {
    // The seq first: an ask closed after it is replayed by the subscription below, so none is missed.
    const seq = yield* store.latestSeq
    const ask = yield* latest(key)
    const projectId = (yield* tasks.byKey(key)).projectId
    // Handed over by this wait alone: the hook leaves the answers to it while it waits.
    const { result, alreadyDelivered } = yield* inbox.handOverAnswers(
      commandId === undefined ? { askId: ask.id } : { askId: ask.id, commandId },
      ask.state !== "open"
        ? Effect.succeed(ask)
        : log.subscribe({ projectId }, seq).pipe(
          Stream.filter((e) => (e.type === "ask.answered" && e.ask.id === ask.id) || (e.type === "ask.withdrawn" && e.id === ask.id)),
          Stream.runHead,
          Effect.orDie,
          Effect.flatMap(() => askById(ask.id)),
        ),
    )
    return { ...result, alreadyDelivered } satisfies AskWaited
  }, Effect.catchTag("SqlError", Effect.die))

  const upload = Effect.fn("AskService.upload")(function* (input: Upload) {
    return yield* drafts.store(input, "paste screenshots into answers", Effect.gen(function* () {
      const [ask] = yield* sql<{ task_id: string; state: string }>`SELECT task_id, state FROM asks WHERE id = ${input.askId}`
      if (!ask) return yield* new NotFound({ entity: "ask", id: input.askId })
      if (ask.state !== "open") return yield* new Invalid({ field: "askId", reason: `this ask is ${ask.state}, so it takes no more answers` })
      return { taskId: ask.task_id, askId: input.askId }
    }).pipe(Effect.catchTag("SqlError", Effect.die)))
  })

  const sweepDrafts = drafts.sweep

  yield* sweepDrafts
  return AskService.of({ create, answer, withdraw, latest, list, wait, upload, sweepDrafts })
})

export const layer = Layer.effect(AskService, make)
