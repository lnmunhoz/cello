// Presence, stage and "last changed" over a real server (CEL-5, CEL-35): a board subscribed to the
// workspace hears an agent session check in, sees its stage change, and gets the sessions in the snapshot.
import { newCommandId } from "@cello/client/client"
import { applyEvents, fromSnapshot } from "@cello/client/sync/applyEvents"
import type { CelloEvent } from "@cello/contract/events"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { connect, startServer, tempDataDir } from "./harness.ts"

const AGENT = { "x-cello-session": "8a41c9e2-presence", "x-cello-client": "Claude Code", "x-cello-pid": String(process.pid) }

const next = (stream: Stream.Stream<CelloEvent, unknown>, n: number) => stream.pipe(Stream.take(n), Stream.runCollect)

describe("presence over a real server", () => {
  it.live("the agent's claim reaches the board with the session checking in; its stage change follows", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const human = yield* connect(port)
      const agent = yield* connect(port, AGENT)
      const snapshot = yield* human["snapshot.get"]({})
      const workspace = snapshot.workspaces[0]!
      const scope = { workspaceId: workspace.id }
      const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId: workspace.id, name: "Cello", key: "CEL" })
      const { result: task } = yield* human["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Watch me" })
      const from = (yield* human["snapshot.get"]({ scope })).seq

      const board = yield* Effect.forkChild(next(human["events.subscribe"]({ scope, afterSeq: from }), 3))
      yield* agent["task.claim"]({ commandId: newCommandId(), key: task.key })
      yield* agent["task.stage"]({ commandId: newCommandId(), key: task.key, stage: "building" })
      const events = yield* Fiber.join(board)

      // The claim, then the check-in after its request (the session now holds a claim), then the stage.
      expect(events.map((e) => e.type)).toEqual(["task.claimed", "session.seen", "task.stage_changed"])
      const [claimed, seen, staged] = events
      expect(seen).toMatchObject({ projectId: null, session: { externalId: "8a41c9e2-presence", endedAt: null, pid: process.pid } })
      expect(seen!.sessionId).toBe(claimed!.sessionId)
      expect(staged).toMatchObject({ after: "building", sessionId: claimed!.sessionId })

      // A fresh board gets the session with the tasks, and the task's last change.
      const fresh = yield* human["snapshot.get"]({ scope })
      expect(fresh.sessions.map((s) => s.externalId)).toEqual(["8a41c9e2-presence"])
      expect(fresh.tasks[0]).toMatchObject({ stage: "building", updatedBySessionId: claimed!.sessionId })
    }).pipe(Effect.scoped))

  it.live("an agent's comment is activity: the board's task counts it and names the session as its last change, as a fresh snapshot does", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const human = yield* connect(port)
      const agent = yield* connect(port, AGENT)
      const workspace = (yield* human["snapshot.get"]({})).workspaces[0]!
      const scope = { workspaceId: workspace.id }
      const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId: workspace.id, name: "Cello", key: "CEL" })
      const { result: task } = yield* human["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Talk to me" })
      yield* agent["task.claim"]({ commandId: newCommandId(), key: task.key })
      const before = yield* human["snapshot.get"]({ scope })

      const board = yield* Effect.forkChild(next(human["events.subscribe"]({ scope, afterSeq: before.seq }), 2))
      const { result: comment } = yield* agent["comment.add"]({ commandId: newCommandId(), taskId: task.id, body: "Halfway there" })
      yield* human["comment.edit"]({ commandId: newCommandId(), id: comment.id, body: "Halfway there, tests pass" })
      const events = yield* Fiber.join(board)
      expect(events.map((e) => e.type)).toEqual(["comment.added", "comment.edited"])

      const live = applyEvents(fromSnapshot(before), events).tasks[task.id]!
      const fresh = (yield* human["snapshot.get"]({ scope })).tasks.find((t) => t.id === task.id)!
      expect(live).toMatchObject({ commentCount: 1, lastCommentAt: events[1]!.ts, updatedAt: events[1]!.ts, updatedBySessionId: null })
      // The live board and a reload agree on everything, the version included.
      expect(fresh).toEqual(live)
      // The agent still holds its claim: Lucas editing a comment isn't him taking the task over.
      expect(fresh.assigneeSessionId).toBe(events[0]!.sessionId)
    }).pipe(Effect.scoped))

  it.live("after a comment is deleted the live board still equals a fresh snapshot, down to deleting the only one", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const human = yield* connect(port)
      const agent = yield* connect(port, AGENT)
      const workspace = (yield* human["snapshot.get"]({})).workspaces[0]!
      const scope = { workspaceId: workspace.id }
      const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId: workspace.id, name: "Cello", key: "CEL" })
      const { result: task } = yield* human["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Say and unsay" })
      const { result: first } = yield* agent["comment.add"]({ commandId: newCommandId(), taskId: task.id, body: "First" })
      const { result: second } = yield* human["comment.add"]({ commandId: newCommandId(), taskId: task.id, body: "Second" })
      const before = yield* human["snapshot.get"]({ scope })

      const board = yield* Effect.forkChild(next(human["events.subscribe"]({ scope, afterSeq: before.seq }), 2))
      yield* human["comment.delete"]({ commandId: newCommandId(), id: second.id })
      const afterOne = (yield* human["snapshot.get"]({ scope })).tasks.find((t) => t.id === task.id)!
      yield* agent["comment.delete"]({ commandId: newCommandId(), id: first.id })
      const events = yield* Fiber.join(board)
      const afterBoth = (yield* human["snapshot.get"]({ scope })).tasks.find((t) => t.id === task.id)!

      expect(applyEvents(fromSnapshot(before), events.slice(0, 1)).tasks[task.id]).toEqual(afterOne)
      expect(afterOne).toMatchObject({ commentCount: 1, lastCommentAt: first.updatedAt })
      expect(applyEvents(fromSnapshot(before), events).tasks[task.id]).toEqual(afterBoth)
      expect(afterBoth).toMatchObject({ commentCount: 0, lastCommentAt: null })
    }).pipe(Effect.scoped))

  it.live("the human's own calls never check anyone in", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const human = yield* connect(port)
      const workspace = (yield* human["snapshot.get"]({})).workspaces[0]!
      const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId: workspace.id, name: "Cello", key: "CEL" })
      const { result: task } = yield* human["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Mine" })
      yield* human["task.claim"]({ commandId: newCommandId(), key: task.key })
      const history = yield* human["task.history"]({ id: task.id })
      expect(history.map((e) => e.type)).toEqual(["task.created", "task.claimed"])
      const snapshot = yield* human["snapshot.get"]({})
      expect(snapshot.sessions).toEqual([])
    }).pipe(Effect.scoped))
})
