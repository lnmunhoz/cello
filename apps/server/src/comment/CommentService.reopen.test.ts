// CEL-110: the human's comment on a task nobody holds (approved and Done, or released) goes to the agent
// session that last held its claim, and reopens the task for it, in the comment's own command: the task
// moves back to In Progress (unless work there is still going on or waiting on the human), that session
// holds the claim again (`task.reopened`), and the comment waits in its inbox like any other, saying the
// task was reopened. A task no agent ever held, agents' comments and Send back notes stay as before.
import type { InboxItem } from "@cello/contract/entities"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import { ContextService } from "../context/ContextService.ts"
import * as EventStore from "../events/EventStore.ts"
import * as InboxService from "../inbox/InboxService.ts"
import * as ReviewService from "../review/ReviewService.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { writePng } from "../testing/media.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as CommentService from "./CommentService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  asHuman(effect).pipe(Effect.provide(services({ ffmpeg: null })), Effect.scoped) as Effect.Effect<A, E>

const x = asAgent({ session: "session-x", client: "Claude Code", pid: process.pid })
const y = asAgent({ session: "session-y", client: "Claude Code", pid: process.pid })
const xBuilder = asAgent({ session: "session-x", client: "Claude Code", pid: process.pid, agent: "a13bfb89", agentType: "cello-builder" })

/** Project CEL and a task in Todo; `say` is the human commenting on it. */
const setup = Effect.gen(function* () {
  const tasks = yield* TaskService.TaskService
  const comments = yield* CommentService.CommentService
  const inbox = yield* InboxService.InboxService
  const reviews = yield* ReviewService.ReviewService
  const { status, project } = yield* setupProject
  const { result: task } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Add the setup video", statusId: status["Todo"]!.id })
  const png = writePng(yield* tempDataDir, "board.png")
  const say = (body: string) => comments.add({ commandId: cmd(), taskId: task.id, body }).pipe(Effect.map((w) => w.result))
  /** Claimed by `as`, submitted, approved: Done, nobody holds it. */
  const doneBy = (as: typeof x) =>
    Effect.gen(function* () {
      yield* as(tasks.claim({ commandId: cmd(), key: task.key }))
      yield* as(reviews.submit({ commandId: cmd(), key: task.key, summary: "Done", steps: ["Look"], files: [{ path: png }], links: [] }))
      yield* reviews.approve({ commandId: cmd(), key: task.key })
    })
  const now = () => tasks.byKey(task.key)
  return { tasks, comments, inbox, reviews, status, project, task, png, say, doneBy, now }
})

/** The task's events from `seq` on, by type, with the reopen's details. */
const eventsSince = (taskId: string, seq: number) =>
  Effect.gen(function* () {
    const events = yield* (yield* EventStore.EventStore).history(taskId)
    return events.filter((e) => e.seq > seq)
  })

const sessionIdOf = (external: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ id: string }>`SELECT id FROM agent_sessions WHERE external_id = ${external}`.pipe(Effect.orDie)
    return row!.id
  })

const said = (items: ReadonlyArray<InboxItem>) =>
  items.map((i) => (i.kind === "comment" ? { body: i.comment.body, reopened: i.reopened ?? null } : { kind: i.kind }))

describe("CommentService: a comment on a task nobody holds reopens it (CEL-110)", () => {
  it.effect("a Done task: back to In Progress, claimed by the session that did it, and the comment in its inbox, saying so", () =>
    run(Effect.gen(function* () {
      const { inbox, status, task, say, doneBy, now } = yield* setup
      yield* doneBy(x)
      const done = yield* now()
      expect([done.statusId, done.assigneeSessionId]).toEqual([status["Done"]!.id, null])
      const sessionX = yield* sessionIdOf("session-x")
      expect(done.lastHolderSessionId).toBe(sessionX)
      // A fresh board knows that session, so the comment box can name it beforehand.
      expect((yield* (yield* SnapshotService.SnapshotService).get()).sessions.map((s) => s.id)).toContain(sessionX)
      const seq = yield* (yield* EventStore.EventStore).latestSeq

      const comment = yield* say("Let's add the instructional video to the repo readme")

      const reopened = yield* now()
      expect(reopened.statusId).toBe(status["In Progress"]!.id)
      expect(reopened.assigneeSessionId).toBe(sessionX)
      expect(reopened.version).toBeGreaterThan(done.version)
      // It reached the session like any comment: the receipt names it.
      expect(comment.delivery).toEqual({ sessionId: sessionX, readAt: null, via: null })
      expect(said(yield* x(inbox.unread))).toEqual([
        { body: "Let's add the instructional video to the repo readme", reopened: { from: "Done", to: "In Progress" } },
      ])
      expect(yield* y(inbox.unread)).toEqual([])
      // The history says so: the move, then the reopen, both the human's, in the comment's command.
      const events = yield* eventsSince(task.id, seq)
      expect(events.map((e) => e.type)).toEqual(["task.moved", "task.reopened"])
      expect(events[1]).toMatchObject({
        type: "task.reopened",
        sessionId: null,
        from: status["Done"]!.id,
        session: sessionX,
        // The comment itself is activity on the task after it (one more version).
        version: reopened.version - 1,
        task: { assigneeSessionId: sessionX, statusId: status["In Progress"]!.id },
      })
      expect(new Set(events.map((e) => e.commandId)).size).toBe(1)
      // The session holds it now: its take lists the task as claimed.
      expect((yield* x(inbox.take({ unreadOnly: true }))).claimed).toEqual(["CEL-1"])
    })))

  it.effect("a released task stays where it is and is claimed by that session again", () =>
    run(Effect.gen(function* () {
      const { tasks, inbox, status, task, say, now } = yield* setup
      yield* x(tasks.claim({ commandId: cmd(), key: task.key }))
      yield* x(tasks.release({ commandId: cmd(), key: task.key }))
      const seq = yield* (yield* EventStore.EventStore).latestSeq
      yield* say("Pick this up again: the copy changed")
      const after = yield* now()
      expect([after.statusId, after.assigneeSessionId]).toEqual([status["In Progress"]!.id, yield* sessionIdOf("session-x")])
      expect((yield* eventsSince(task.id, seq)).map((e) => e.type)).toEqual(["task.reopened"])
      expect(said(yield* x(inbox.unread))).toEqual([
        { body: "Pick this up again: the copy changed", reopened: { from: "In Progress", to: "In Progress" } },
      ])
    })))

  it.effect("a task no agent ever held stays as it is: no claim, no move, nobody gets the comment", () =>
    run(Effect.gen(function* () {
      const { inbox, status, task, say, now } = yield* setup
      const before = yield* now()
      const seq = yield* (yield* EventStore.EventStore).latestSeq
      const comment = yield* say("An idea for later")
      const after = yield* now()
      expect([after.statusId, after.assigneeSessionId, after.lastHolderSessionId]).toEqual([status["Todo"]!.id, null, null])
      expect(after.version).toBe(before.version + 1)
      expect(comment.delivery).toBeNull()
      expect(yield* eventsSince(task.id, seq)).toEqual([])
      expect(yield* x(inbox.unread)).toEqual([])
    })))

  it.effect("an agent's comment never reopens anything, its own session's or another's", () =>
    run(Effect.gen(function* () {
      const { comments, inbox, status, task, doneBy, now } = yield* setup
      yield* doneBy(x)
      yield* x(comments.add({ commandId: cmd(), taskId: task.id, body: "Merged and deployed" }))
      yield* y(comments.add({ commandId: cmd(), taskId: task.id, body: "Looked at this too" }))
      const after = yield* now()
      expect([after.statusId, after.assigneeSessionId]).toEqual([status["Done"]!.id, null])
      expect(yield* x(inbox.unread)).toEqual([])
    })))

  it.effect("a Send back is unaffected: the note goes to the submitter, and no claim comes back with it", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, inbox, status, task, png, now } = yield* setup
      yield* x(tasks.claim({ commandId: cmd(), key: task.key }))
      yield* x(reviews.submit({ commandId: cmd(), key: task.key, summary: "Done", steps: ["Look"], files: [{ path: png }], links: [] }))
      // A rename during review ends the claim (CEL-46); the Send back then reaches the submitter only.
      const current = yield* now()
      yield* tasks.update({ commandId: cmd(), id: task.id, expectedVersion: current.version, title: "Add the setup video (renamed)" })
      const seq = yield* (yield* EventStore.EventStore).latestSeq
      yield* reviews.sendBack({ commandId: cmd(), key: task.key, note: "The video is missing" })
      const after = yield* now()
      expect([after.statusId, after.assigneeSessionId]).toEqual([status["In Progress"]!.id, null])
      expect((yield* eventsSince(task.id, seq)).map((e) => e.type)).not.toContain("task.reopened")
      expect((yield* x(inbox.unread)).map((i) => i.kind)).toEqual(["claim_ended", "send_back"])
    })))

  it.effect("a task in review whose claim a change ended stays in review: the comment gives the claim back, the packet stays open", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, inbox, status, task, png, say, now } = yield* setup
      yield* x(tasks.claim({ commandId: cmd(), key: task.key }))
      yield* x(reviews.submit({ commandId: cmd(), key: task.key, summary: "Done", steps: ["Look"], files: [{ path: png }], links: [] }))
      const current = yield* now()
      yield* tasks.update({ commandId: cmd(), id: task.id, expectedVersion: current.version, title: "Add the setup video (renamed)" })
      yield* say("Looks right; also check the dark theme")
      const after = yield* now()
      expect([after.statusId, after.assigneeSessionId]).toEqual([status["In Review"]!.id, yield* sessionIdOf("session-x")])
      expect((yield* reviews.list(task.id)).map((r) => r.decision)).toEqual([null])
      expect(said(yield* x(inbox.unread))).toEqual([
        { kind: "claim_ended" },
        { body: "Looks right; also check the dark theme", reopened: { from: "In Review", to: "In Review" } },
      ])
    })))

  it.effect("the last session to hold the claim gets it: the human's own claims and other sessions before it don't count", () =>
    run(Effect.gen(function* () {
      const { tasks, inbox, status, task, say, doneBy, now } = yield* setup
      // X worked on it first, then Y finished it: Y gets the comment.
      yield* x(tasks.claim({ commandId: cmd(), key: task.key }))
      yield* x(tasks.release({ commandId: cmd(), key: task.key }))
      yield* doneBy(y)
      yield* say("For Y")
      expect((yield* now()).assigneeSessionId).toBe(yield* sessionIdOf("session-y"))
      expect(said(yield* y(inbox.unread)).map((i) => ("body" in i ? i.body : i.kind))).toEqual(["For Y"])
      expect(yield* x(inbox.unread)).toEqual([])

      // The human takes it over from Y, then lets go: Y is still the last agent that held it.
      yield* tasks.claim({ commandId: cmd(), key: task.key })
      yield* tasks.release({ commandId: cmd(), key: task.key })
      yield* tasks.move({ commandId: cmd(), id: task.id, statusId: status["Done"]!.id })
      yield* say("For Y again")
      expect((yield* now()).assigneeSessionId).toBe(yield* sessionIdOf("session-y"))
    })))

  it.effect("a subagent's claim is its session's: the comment goes to the session, never to a subagent", () =>
    run(Effect.gen(function* () {
      const { tasks, inbox, task, say, now } = yield* setup
      yield* xBuilder(tasks.claim({ commandId: cmd(), key: task.key }))
      yield* xBuilder(tasks.release({ commandId: cmd(), key: task.key }))
      yield* say("For the session")
      expect((yield* now()).assigneeSessionId).toBe(yield* sessionIdOf("session-x"))
      expect(yield* x(inbox.unread)).toHaveLength(1)
    })))

  it.effect("cello context stops listing a claim as lost once a comment gave the task back to the session", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task, say } = yield* setup
      const context = yield* ContextService
      const lostKeys = Effect.map(x(context.context({ key: "CEL" })), (c) => c.lostClaims.map((l) => l.taskKey))
      yield* x(tasks.claim({ commandId: cmd(), key: task.key }))
      // The human drags it back to Todo: X lost the claim.
      yield* tasks.move({ commandId: cmd(), id: task.id, statusId: status["Todo"]!.id })
      expect(yield* lostKeys).toEqual(["CEL-1"])
      // His comment gives it back: claimed by X, so not lost any more.
      yield* say("Actually, carry on with it")
      const after = yield* x(context.context({ key: "CEL" }))
      expect(after.claimed.map((t) => t.key)).toEqual(["CEL-1"])
      expect(after.lostClaims).toEqual([])
    })))

  it.effect("a Canceled task an agent worked on is reopened too", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task, say, now } = yield* setup
      yield* x(tasks.claim({ commandId: cmd(), key: task.key }))
      yield* tasks.move({ commandId: cmd(), id: task.id, statusId: status["Canceled"]!.id })
      yield* say("Let's do it after all")
      const after = yield* now()
      expect([after.statusId, after.assigneeSessionId]).toEqual([status["In Progress"]!.id, yield* sessionIdOf("session-x")])
    })))

  it.effect("a task the human holds, or an archived one, isn't reopened", () =>
    run(Effect.gen(function* () {
      const { tasks, inbox, status, task, say, doneBy, now } = yield* setup
      yield* doneBy(x)
      yield* tasks.claim({ commandId: cmd(), key: task.key })
      yield* say("Mine now")
      expect((yield* now()).assigneeSessionId).toBeNull()
      expect((yield* now()).assigneeActorId).not.toBeNull()
      yield* tasks.release({ commandId: cmd(), key: task.key })
      yield* tasks.move({ commandId: cmd(), id: task.id, statusId: status["Done"]!.id })
      yield* tasks.archive({ commandId: cmd(), id: task.id })
      yield* say("A note on an archived task")
      const after = yield* now()
      expect([after.statusId, after.assigneeSessionId, after.archivedAt !== null]).toEqual([status["Done"]!.id, null, true])
      expect(yield* x(inbox.unread)).toEqual([])
    })))
})
