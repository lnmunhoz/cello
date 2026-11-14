// Tests 4–7: claiming a task, a live claim refusing a second session, taking over from a gone
// holder, and a human change ending a claim. Plus release.
import { describe, expect, it } from "@effect/vitest"
import type { CelloEvent } from "@cello/contract/events"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"
import * as EventStore from "../events/EventStore.ts"
import * as Seed from "../persistence/Seed.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as TaskService from "./TaskService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

const live = { session: "session-live", client: "Claude Code", pid: process.pid }
const other = { session: "session-other", client: "Claude Code", pid: process.pid }

/** A project with one task in Todo, created by the human. */
const setup = Effect.gen(function* () {
  const tasks = yield* TaskService.TaskService
  const { status, project } = yield* setupProject
  const { result: task } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Claim me", statusId: status["Todo"]!.id })
  return { tasks, status, task }
})

const history = (id: string) =>
  Effect.gen(function* () {
    return yield* (yield* EventStore.EventStore).history(id)
  })
const historyTypes = (id: string) => Effect.map(history(id), (events) => events.map((e) => e.type))
const lastEvent = (id: string) => Effect.map(history(id), (events) => events.at(-1)!)

describe("TaskService.claim", () => {
  it.effect("assigns the task to the calling session and moves it to the first started status", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task } = yield* setup
      const { result: claimed, seq } = yield* asAgent(live)(tasks.claim({ commandId: cmd(), key: task.key }))
      expect(claimed.statusId).toBe(status["In Progress"]!.id)
      expect(claimed.assigneeSessionId).not.toBeNull()
      expect(claimed.assigneeActorId).not.toBe((yield* Seed.HumanActor).id)
      expect(claimed.version).toBe(task.version + 1)

      const event = yield* lastEvent(task.id)
      expect(event).toMatchObject({ type: "task.claimed", seq, sessionId: claimed.assigneeSessionId, actorId: claimed.assigneeActorId })

      // Claiming again from the same session changes nothing.
      const again = yield* asAgent(live)(tasks.claim({ commandId: cmd(), key: task.key.toLowerCase() }))
      expect(again).toEqual({ result: claimed, seq: null })
    })))

  it.effect("keeps a task that's already in a started status where it is", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task } = yield* setup
      yield* tasks.move({ commandId: cmd(), id: task.id, statusId: status["In Review"]!.id })
      const { result } = yield* asAgent(live)(tasks.claim({ commandId: cmd(), key: task.key }))
      expect(result.statusId).toBe(status["In Review"]!.id)
    })))

  it.effect("a second session can't take a live claim; the error names the holder", () =>
    run(Effect.gen(function* () {
      const { tasks, task } = yield* setup
      yield* asAgent(live)(tasks.claim({ commandId: cmd(), key: task.key }))
      const error = yield* Effect.flip(asAgent(other)(tasks.claim({ commandId: cmd(), key: task.key })))
      expect(error).toMatchObject({ _tag: "TaskClaimed", key: task.key, holder: "Claude Code", sessionId: live.session, lastSeenAt: 0 })
    })))

  it.effect("a claim held by an exited process is taken over and writes task.claim_taken", () =>
    run(Effect.gen(function* () {
      const { tasks, task } = yield* setup
      const exited = Bun.spawnSync(["true"]).pid
      const { result: first } = yield* asAgent({ ...live, pid: exited })(tasks.claim({ commandId: cmd(), key: task.key }))
      const { result: taken } = yield* asAgent(other)(tasks.claim({ commandId: cmd(), key: task.key }))
      expect(taken.assigneeSessionId).not.toBe(first.assigneeSessionId)
      expect(yield* lastEvent(task.id)).toMatchObject({
        type: "task.claim_taken",
        sessionId: taken.assigneeSessionId,
        from: { actorId: first.assigneeActorId, sessionId: first.assigneeSessionId },
        reason: "holder_exited",
      })
    })))

  it.effect("with no pid, a claim is taken over after 2 quiet hours, not before", () =>
    run(Effect.gen(function* () {
      const { tasks, task } = yield* setup
      const noPid = { session: "no-pid", client: "Codex" }
      yield* asAgent(noPid)(tasks.claim({ commandId: cmd(), key: task.key }))
      yield* TestClock.adjust("2 hours")
      expect(yield* Effect.flip(asAgent(other)(tasks.claim({ commandId: cmd(), key: task.key })))).toMatchObject({
        _tag: "TaskClaimed",
        holder: "Codex",
      })
      yield* TestClock.adjust("1 millis")
      yield* asAgent(other)(tasks.claim({ commandId: cmd(), key: task.key }))
      expect(yield* lastEvent(task.id)).toMatchObject({ type: "task.claim_taken", reason: "holder_idle" })
    })))

  it.effect("a done task's claim no longer holds", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task } = yield* setup
      yield* asAgent(live)(tasks.claim({ commandId: cmd(), key: task.key }))
      yield* asAgent(live)(tasks.move({ commandId: cmd(), id: task.id, statusId: status["Done"]!.id }))
      const { result } = yield* asAgent(other)(tasks.claim({ commandId: cmd(), key: task.key }))
      expect(result.statusId).toBe(status["In Progress"]!.id)
      expect((yield* lastEvent(task.id)).type).toBe("task.claimed")
    })))

  it.effect("the human always wins: claiming an agent's task takes it over", () =>
    run(Effect.gen(function* () {
      const { tasks, task } = yield* setup
      yield* asAgent(live)(tasks.claim({ commandId: cmd(), key: task.key }))
      const { result } = yield* tasks.claim({ commandId: cmd(), key: task.key })
      expect(result).toMatchObject({ assigneeActorId: (yield* Seed.HumanActor).id, assigneeSessionId: null })
      expect(yield* lastEvent(task.id)).toMatchObject({ type: "task.claim_taken", reason: "human" })
    })))

  it.effect("an unknown key is NotFound", () =>
    run(Effect.gen(function* () {
      const { tasks } = yield* setup
      expect(yield* Effect.flip(tasks.claim({ commandId: cmd(), key: "CEL-99" }))).toMatchObject({ _tag: "NotFound", entity: "task", id: "CEL-99" })
      expect(yield* Effect.flip(tasks.claim({ commandId: cmd(), key: "nonsense" }))).toMatchObject({ _tag: "NotFound", entity: "task" })
    })))
})

describe("a human change ends a claim", () => {
  it.effect("editing, moving or labelling an agent's task as the human clears the claim and writes task.claim_ended", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task } = yield* setup
      const { result: claimed } = yield* asAgent(live)(tasks.claim({ commandId: cmd(), key: task.key }))
      const { result: edited } = yield* tasks.update({ commandId: cmd(), id: task.id, expectedVersion: claimed.version, title: "Renamed" })
      expect(edited).toMatchObject({ assigneeActorId: null, assigneeSessionId: null, title: "Renamed" })
      expect(yield* historyTypes(task.id)).toEqual(["task.created", "task.claimed", "task.updated", "task.claim_ended"])
      const ended = (yield* lastEvent(task.id)) as Extract<CelloEvent, { type: "task.claim_ended" }>
      expect(ended).toMatchObject({
        from: { actorId: claimed.assigneeActorId, sessionId: claimed.assigneeSessionId },
        reason: "human_change",
        version: edited.version,
      })

      yield* asAgent(live)(tasks.claim({ commandId: cmd(), key: task.key }))
      const { result: moved } = yield* tasks.move({ commandId: cmd(), id: task.id, statusId: status["In Review"]!.id })
      expect(moved.assigneeSessionId).toBeNull()
      expect((yield* lastEvent(task.id)).type).toBe("task.claim_ended")
    })))

  it.effect("another agent's change doesn't end the claim", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task } = yield* setup
      const { result: claimed } = yield* asAgent(live)(tasks.claim({ commandId: cmd(), key: task.key }))
      const { result: moved } = yield* asAgent(other)(tasks.move({ commandId: cmd(), id: task.id, statusId: status["Todo"]!.id }))
      expect(moved.assigneeSessionId).toBe(claimed.assigneeSessionId)
    })))
})

describe("TaskService.release", () => {
  it.effect("the holder gives up its claim; the task keeps its status", () =>
    run(Effect.gen(function* () {
      const { tasks, task } = yield* setup
      const { result: claimed } = yield* asAgent(live)(tasks.claim({ commandId: cmd(), key: task.key }))
      const { result: released } = yield* asAgent(live)(tasks.release({ commandId: cmd(), key: task.key }))
      expect(released).toMatchObject({ assigneeActorId: null, assigneeSessionId: null, statusId: claimed.statusId })
      expect((yield* lastEvent(task.id)).type).toBe("task.released")
    })))

  it.effect("another session can't release it; an unclaimed task can't be released", () =>
    run(Effect.gen(function* () {
      const { tasks, task } = yield* setup
      expect(yield* Effect.flip(asAgent(live)(tasks.release({ commandId: cmd(), key: task.key })))).toMatchObject({
        _tag: "Invalid",
        reason: `${task.key} isn't claimed`,
      })
      yield* asAgent(live)(tasks.claim({ commandId: cmd(), key: task.key }))
      expect(yield* Effect.flip(asAgent(other)(tasks.release({ commandId: cmd(), key: task.key })))).toMatchObject({
        _tag: "Invalid",
        reason: `${task.key} is claimed by another session`,
      })
      // The human can release anyone's claim.
      const { result } = yield* tasks.release({ commandId: cmd(), key: task.key })
      expect(result.assigneeSessionId).toBeNull()
    })))
})
