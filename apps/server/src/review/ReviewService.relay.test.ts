// Approve from chat (CEL-169). The human approves in the Claude chat; the agent they're talking to passes it
// on with `cello task approve --quote` (ReviewService.relayApproval). It does what the Review page's Approve
// does, stored as the human's approval relayed by that session, with their words as the note and as a comment.
// Only the session holding the claim can pass it on, never a subagent, and only for a packet waiting on the human.
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as AskService from "../ask/AskService.ts"
import * as CommentService from "../comment/CommentService.ts"
import * as EventStore from "../events/EventStore.ts"
import * as InboxService from "../inbox/InboxService.ts"
import * as ProjectService from "../project/ProjectService.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { writePng } from "../testing/media.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as ReviewService from "./ReviewService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  asHuman(effect).pipe(Effect.provide(services({ ffmpeg: null })), Effect.scoped) as Effect.Effect<A, E>

const agent = asAgent({ session: "session-relay", client: "Claude Code", pid: process.pid })
const other = asAgent({ session: "session-relay-other", client: "Claude Code", pid: process.pid })
const subagent = asAgent({ session: "session-relay", client: "Claude Code", pid: process.pid, agent: "a1", agentType: "cello-builder" })

const QUOTE = "Approved, commit"

/** CEL with the setting as given, and CEL-1 claimed by the agent; submitted (In Review) unless `submit` is false. */
const board = (mergeAfterApproval: boolean, submit = true) =>
  Effect.gen(function* () {
    const tasks = yield* TaskService.TaskService
    const reviews = yield* ReviewService.ReviewService
    const { status, project } = yield* setupProject
    yield* (yield* ProjectService.ProjectService).update({ commandId: cmd(), id: project.id, mergeAfterApproval })
    const { result: created } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Approve from chat", statusId: status["Todo"]!.id })
    const { result: claimed } = yield* agent(tasks.claim({ commandId: cmd(), key: created.key }))
    if (submit) {
      const png = writePng(yield* tempDataDir, "board.png")
      yield* agent(reviews.submit({ commandId: cmd(), key: created.key, summary: "Done", steps: ["Look"], files: [{ path: png }], links: [] }))
    }
    return { tasks, reviews, status, project, key: created.key, taskId: created.id, sessionId: claimed.assigneeSessionId! }
  })

const typesOf = (commandId: string) =>
  Effect.gen(function* () {
    const workspaceId = (yield* (yield* SnapshotService.SnapshotService).get()).workspaces[0]!.id
    const all = yield* (yield* EventStore.EventStore).readAfter({ workspaceId, projectId: null }, 0)
    return all.filter((e) => e.commandId === commandId).map((e) => e.type)
  })

const inboxOf = (who: typeof agent) => who(Effect.flatMap(Effect.service(InboxService.InboxService), (inbox) => inbox.take({ unreadOnly: true })))

describe("an approval passed on from chat, in a project that merges after approval", () => {
  it.effect("is Approved · merging, stored as the human's approval relayed by the session, with their words as a comment; then done", () =>
    run(Effect.gen(function* () {
      const { reviews, status, key, taskId, sessionId } = yield* board(true)
      const commandId = cmd()
      const { result } = yield* agent(reviews.relayApproval({ commandId, key, quote: `  ${QUOTE}  ` }))

      expect(result).toMatchObject({ statusId: status["In Review"]!.id, stage: "merging", assigneeSessionId: sessionId })
      expect((yield* reviews.list(taskId))[0]).toMatchObject({
        decision: "approved",
        decisionNote: QUOTE,
        relayedBy: { name: "Claude Code", session: "session-relay" },
      })
      const comments = yield* (yield* CommentService.CommentService).list(taskId)
      expect(comments).toEqual([expect.objectContaining({ body: `**Lucas, in chat (approval):** "${QUOTE}"`, sessionId })])
      expect(yield* typesOf(commandId)).toEqual(["review.decided", "comment.added", "task.stage_changed"])
      // Its own action: nothing waits for the session, and nothing wakes it.
      expect((yield* inboxOf(agent)).items).toEqual([])

      // A retry gets the same answer, once.
      expect((yield* agent(reviews.relayApproval({ commandId, key, quote: QUOTE }))).result).toEqual(result)
      expect(yield* (yield* CommentService.CommentService).list(taskId)).toHaveLength(1)

      const { result: finished } = yield* agent(reviews.done({ commandId: cmd(), key }))
      expect(finished).toMatchObject({ statusId: status["Done"]!.id, stage: null, assigneeSessionId: null })
    })))

  it.effect("the decision event says who relayed it, so a client's review list fills in live", () =>
    run(Effect.gen(function* () {
      const { reviews, key, taskId } = yield* board(true)
      yield* agent(reviews.relayApproval({ commandId: cmd(), key, quote: QUOTE }))
      const workspaceId = (yield* (yield* SnapshotService.SnapshotService).get()).workspaces[0]!.id
      const all = yield* (yield* EventStore.EventStore).readAfter({ workspaceId, projectId: null }, 0)
      const decided = all.filter((e) => e.type === "review.decided" && e.taskId === taskId)
      expect(decided).toEqual([expect.objectContaining({
        decision: "approved",
        note: QUOTE,
        relayedBy: { name: "Claude Code", session: "session-relay" },
        sessionId: expect.any(String),
      })])
    })))

  it.effect("a packet open while the task waits in Needs input can be approved, the same as on the Review page", () =>
    run(Effect.gen(function* () {
      const { reviews, status, key, sessionId } = yield* board(true)
      yield* agent((yield* AskService.AskService).create({
        commandId: cmd(), key, title: "Merge now?", intro: "", questions: [{ prompt: "Merge it now?", options: [{ label: "Yes" }, { label: "No" }] }],
        files: [], links: [],
      }))
      const { result } = yield* agent(reviews.relayApproval({ commandId: cmd(), key, quote: QUOTE }))
      expect(result).toMatchObject({ statusId: status["In Review"]!.id, stage: "merging", assigneeSessionId: sessionId })
    })))
})

describe("an approval passed on from chat, in a project that merges before review (the setting off)", () => {
  it.effect("moves it to Done and ends the claim, telling no one", () =>
    run(Effect.gen(function* () {
      const { reviews, status, key, sessionId } = yield* board(false)
      const commandId = cmd()
      const { result } = yield* agent(reviews.relayApproval({ commandId, key, quote: QUOTE }))
      expect(result).toMatchObject({
        statusId: status["Done"]!.id,
        stage: null,
        assigneeSessionId: null,
        assigneeActorId: null,
        lastHolderSessionId: sessionId,
      })
      expect(yield* typesOf(commandId)).toEqual(["review.decided", "comment.added", "task.moved", "task.released"])
      expect((yield* inboxOf(agent)).items).toEqual([])
    })))
})

describe("an approval from the human themselves, through the same command", () => {
  it.effect("is a plain Approve with their words as the note: no relay marker, no comment", () =>
    run(Effect.gen(function* () {
      const { reviews, status, key, taskId, sessionId } = yield* board(true)
      const { result } = yield* reviews.relayApproval({ commandId: cmd(), key, quote: QUOTE })
      expect(result).toMatchObject({ statusId: status["In Review"]!.id, stage: "merging", assigneeSessionId: sessionId })
      expect((yield* reviews.list(taskId))[0]).toMatchObject({ decision: "approved", decisionNote: QUOTE, relayedBy: null })
      expect(yield* (yield* CommentService.CommentService).list(taskId)).toEqual([])
      expect((yield* inboxOf(agent)).items.map((i) => i.kind)).toEqual(["approved"])
    })))
})

describe("an approval passed on from chat is refused", () => {
  const untouched = (key: string, before: unknown) =>
    Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      expect(yield* tasks.byKey(key)).toEqual(before)
    })

  it.effect("without their words", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, key } = yield* board(true)
      const before = yield* tasks.byKey(key)
      expect(yield* Effect.flip(agent(reviews.relayApproval({ commandId: cmd(), key, quote: "   " })))).toMatchObject({ _tag: "Invalid", field: "quote" })
      yield* untouched(key, before)
    })))

  it.effect("from a subagent: it never sees the human's chat", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, key } = yield* board(true)
      const before = yield* tasks.byKey(key)
      expect(yield* Effect.flip(subagent(reviews.relayApproval({ commandId: cmd(), key, quote: QUOTE })))).toMatchObject({
        _tag: "Invalid",
        field: "key",
        reason: `${key} can't be approved by a subagent: only the session the human is talking to passes on their approval from chat`,
      })
      yield* untouched(key, before)
    })))

  it.effect("from a session that doesn't hold the claim", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, key } = yield* board(true)
      const before = yield* tasks.byKey(key)
      expect(yield* Effect.flip(other(reviews.relayApproval({ commandId: cmd(), key, quote: QUOTE })))).toMatchObject({
        _tag: "Invalid",
        field: "key",
        reason: `${key} is claimed by another session: only the session holding its claim passes on the human's approval`,
      })
      yield* untouched(key, before)
    })))

  it.effect("on a task nobody holds", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, key } = yield* board(true)
      yield* agent(tasks.release({ commandId: cmd(), key }))
      const before = yield* tasks.byKey(key)
      expect(yield* Effect.flip(agent(reviews.relayApproval({ commandId: cmd(), key, quote: QUOTE })))).toMatchObject({
        _tag: "Invalid",
        field: "key",
        reason: `${key} isn't claimed: claim it first (\`cello task claim ${key}\`), then pass on the human's approval`,
      })
      yield* untouched(key, before)
    })))

  it.effect("with no packet waiting: submit it first", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, key } = yield* board(true, false)
      const before = yield* tasks.byKey(key)
      expect(yield* Effect.flip(agent(reviews.relayApproval({ commandId: cmd(), key, quote: QUOTE })))).toMatchObject({
        _tag: "Invalid",
        field: "key",
        reason: `${key} has no packet waiting for the human: hand the work in with \`cello task submit ${key}\` first, then pass on their approval`,
      })
      yield* untouched(key, before)
    })))

  it.effect("once approved already and waiting for the merge", () =>
    run(Effect.gen(function* () {
      const { reviews, key } = yield* board(true)
      yield* agent(reviews.relayApproval({ commandId: cmd(), key, quote: QUOTE }))
      expect(yield* Effect.flip(agent(reviews.relayApproval({ commandId: cmd(), key, quote: QUOTE })))).toMatchObject({
        _tag: "Invalid",
        field: "key",
        reason: `${key} is approved already and waits for your merge: merge it, then \`cello task done ${key}\``,
      })
    })))

  it.effect("once it's Done", () =>
    run(Effect.gen(function* () {
      const { reviews, key } = yield* board(false)
      yield* agent(reviews.relayApproval({ commandId: cmd(), key, quote: QUOTE }))
      expect(yield* Effect.flip(agent(reviews.relayApproval({ commandId: cmd(), key, quote: QUOTE })))).toMatchObject({ _tag: "Invalid", field: "key" })
    })))
})
