// Where a task is inside In Progress (CEL-35) and who changed it last (CEL-5).
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as EventStore from "../events/EventStore.ts"
import stagePlanning from "../persistence/migrations/0020_stage_planning.ts"
import * as Seed from "../persistence/Seed.ts"
import * as AskService from "../ask/AskService.ts"
import * as ReviewService from "../review/ReviewService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as TaskService from "./TaskService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services({ ffmpeg: null }))) as Effect.Effect<A, E>

const builder = { session: "session-builder", client: "Claude Code", pid: process.pid }
const other = { session: "session-other", client: "Claude Code", pid: process.pid }

/** A task the builder session has claimed: In Progress. */
const claimed = Effect.gen(function* () {
  const tasks = yield* TaskService.TaskService
  const { status, project } = yield* setupProject
  const { result: task } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Stage me", statusId: status["Todo"]!.id })
  const { result } = yield* asAgent(builder)(tasks.claim({ commandId: cmd(), key: task.key }))
  return { tasks, status, task: result }
})

const lastEvent = (id: string) =>
  Effect.gen(function* () {
    return (yield* (yield* EventStore.EventStore).history(id)).at(-1)!
  })

describe("TaskService.setStage", () => {
  it.effect("a retry of a command stored while the stage was called designing gets planning back, once 0020 ran (CEL-105)", () =>
    run(Effect.gen(function* () {
      const { tasks, task } = yield* claimed
      const sql = yield* SqlClient.SqlClient
      const commandId = cmd()
      yield* asAgent(builder)(tasks.setStage({ commandId, key: task.key, stage: "planning" }))
      // As it was stored before the rename.
      yield* sql`UPDATE command_receipts SET result = replace(result, '"stage":"planning"', '"stage":"designing"') WHERE command_id = ${commandId}`.pipe(Effect.orDie)
      yield* stagePlanning.pipe(Effect.orDie)
      const { result } = yield* asAgent(builder)(tasks.setStage({ commandId, key: task.key, stage: "planning" }))
      expect(result.stage).toBe("planning")
    })))

  it.effect("the claim holder sets a stage: stored on the task, with a task.stage_changed event and a new version", () =>
    run(Effect.gen(function* () {
      const { tasks, task } = yield* claimed
      const { result, seq } = yield* asAgent(builder)(tasks.setStage({ commandId: cmd(), key: task.key, stage: "building" }))
      expect(result.stage).toBe("building")
      expect(result.version).toBe(task.version + 1)
      expect(yield* lastEvent(task.id)).toMatchObject({
        type: "task.stage_changed", seq, id: task.id, version: result.version, before: null, after: "building", sessionId: task.assigneeSessionId,
      })

      const { result: review } = yield* asAgent(builder)(tasks.setStage({ commandId: cmd(), key: task.key, stage: "review" }))
      expect(yield* lastEvent(task.id)).toMatchObject({ type: "task.stage_changed", before: "building", after: "review" })
      expect(review.stage).toBe("review")
    })))

  it.effect("setting the stage it already has changes nothing; null clears it", () =>
    run(Effect.gen(function* () {
      const { tasks, task } = yield* claimed
      const { result: building } = yield* asAgent(builder)(tasks.setStage({ commandId: cmd(), key: task.key, stage: "building" }))
      const again = yield* asAgent(builder)(tasks.setStage({ commandId: cmd(), key: task.key, stage: "building" }))
      expect(again).toEqual({ result: building, seq: null })
      const { result: cleared } = yield* asAgent(builder)(tasks.setStage({ commandId: cmd(), key: task.key, stage: null }))
      expect(cleared.stage).toBeNull()
      expect(yield* lastEvent(task.id)).toMatchObject({ type: "task.stage_changed", before: "building", after: null })
    })))

  it.effect("another agent session is refused, and so is an agent on a task nobody claimed", () =>
    run(Effect.gen(function* () {
      const { tasks, task, status } = yield* claimed
      const refused = yield* Effect.flip(asAgent(other)(tasks.setStage({ commandId: cmd(), key: task.key, stage: "review" })))
      expect(refused).toMatchObject({ _tag: "Invalid", field: "key" })
      expect((refused as { reason: string }).reason).toContain("claimed by another session")

      const { result: free } = yield* tasks.create({ commandId: cmd(), projectId: task.projectId, title: "Free", statusId: status["In Progress"]!.id })
      const unclaimed = yield* Effect.flip(asAgent(other)(tasks.setStage({ commandId: cmd(), key: free.key, stage: "building" })))
      expect((unclaimed as { reason: string }).reason).toContain("claim it first")
    })))

  it.effect("the human can set it, and keeps the agent's claim", () =>
    run(Effect.gen(function* () {
      const { tasks, task } = yield* claimed
      const { result } = yield* tasks.setStage({ commandId: cmd(), key: task.key, stage: "merged" })
      expect(result).toMatchObject({ stage: "merged", assigneeSessionId: task.assigneeSessionId })
    })))

  it.effect("is refused outside In Progress", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task } = yield* claimed
      yield* asAgent(builder)(tasks.move({ commandId: cmd(), id: task.id, statusId: status["Todo"]!.id }))
      const error = yield* Effect.flip(asAgent(builder)(tasks.setStage({ commandId: cmd(), key: task.key, stage: "building" })))
      expect(error).toMatchObject({ _tag: "Invalid", field: "stage" })
      expect((error as { reason: string }).reason).toContain("In Progress")
    })))
})

describe("a stage is cleared", () => {
  it.effect("when the task leaves In Progress; reordering inside it keeps the stage", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task } = yield* claimed
      yield* asAgent(builder)(tasks.setStage({ commandId: cmd(), key: task.key, stage: "fixing" }))
      const { result: other } = yield* tasks.create({ commandId: cmd(), projectId: task.projectId, title: "Neighbor", statusId: status["In Progress"]!.id })
      const { result: reordered } = yield* asAgent(builder)(tasks.move({ commandId: cmd(), id: task.id, statusId: status["In Progress"]!.id, after: other.id }))
      expect(reordered.stage).toBe("fixing")
      const { result: moved } = yield* asAgent(builder)(tasks.move({ commandId: cmd(), id: task.id, statusId: status["Todo"]!.id }))
      expect(moved.stage).toBeNull()
      expect(yield* lastEvent(task.id)).toMatchObject({ type: "task.moved", task: { stage: null } })
    })))

  it.effect("when the task is submitted for review", () =>
    run(Effect.gen(function* () {
      const { tasks, task } = yield* claimed
      yield* asAgent(builder)(tasks.setStage({ commandId: cmd(), key: task.key, stage: "merged" }))
      const { result } = yield* asAgent(builder)(
        (yield* ReviewService.ReviewService).submit({ commandId: cmd(), key: task.key, summary: "Done", steps: ["Look"], files: [], links: [{ url: "https://example.com/pr/1" }] }),
      )
      expect(result.task.stage).toBeNull()
      expect((yield* tasks.byKey(task.key)).stage).toBeNull()
    })))
})

describe("a stage stays", () => {
  // Asking Lucas (CEL-47) pauses the work without changing where it is: the stage waits in Needs input
  // and is still there when his answers bring the task back to In Progress.
  it.effect("while the task waits in Needs input, and when the answers bring it back to In Progress", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task } = yield* claimed
      const asks = yield* AskService.AskService
      yield* asAgent(builder)(tasks.setStage({ commandId: cmd(), key: task.key, stage: "review" }))
      const { result: asked } = yield* asAgent(builder)(asks.create({
        commandId: cmd(), key: task.key, title: "Which option?", questions: [{ prompt: "Ship it?" }], files: [], links: [],
      }))
      expect(asked.task).toMatchObject({ statusId: status["Needs input"]!.id, stage: "review" })

      const { result: answered } = yield* asks.answer({
        commandId: cmd(), askId: asked.ask.id, answers: [{ questionId: "q1", optionIds: [], comment: "Yes" }],
      })
      expect(answered.task).toMatchObject({ statusId: status["In Progress"]!.id, stage: "review" })
    })))

  it.effect("but not when Lucas moves a waiting task anywhere other than In Progress", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task } = yield* claimed
      const asks = yield* AskService.AskService
      yield* asAgent(builder)(tasks.setStage({ commandId: cmd(), key: task.key, stage: "fixing" }))
      yield* asAgent(builder)(asks.create({ commandId: cmd(), key: task.key, title: "Which?", questions: [{ prompt: "Ship it?" }], files: [], links: [] }))
      const { result } = yield* tasks.move({ commandId: cmd(), id: task.id, statusId: status["Todo"]!.id })
      expect(result.stage).toBeNull()
    })))
})

describe("last changed", () => {
  it.effect("every task change records who made it: the creator at first, then each change's caller", () =>
    run(Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      const human = yield* Seed.HumanActor
      const { status, project } = yield* setupProject
      const { result: created } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Track me", statusId: status["Todo"]!.id })
      expect(created).toMatchObject({ updatedByActorId: human.id, updatedBySessionId: null })

      const { result: byAgent } = yield* asAgent(builder)(tasks.claim({ commandId: cmd(), key: created.key }))
      expect(byAgent).toMatchObject({ updatedByActorId: byAgent.assigneeActorId, updatedBySessionId: byAgent.assigneeSessionId })

      const { result: renamed } = yield* tasks.update({ commandId: cmd(), id: created.id, expectedVersion: byAgent.version, title: "Renamed" })
      expect(renamed).toMatchObject({ updatedByActorId: human.id, updatedBySessionId: null })

      const { result: labelled } = yield* asAgent(other)(tasks.setLabels({ commandId: cmd(), id: created.id, add: [], remove: [] }))
      expect(labelled.updatedByActorId).toBe(human.id) // no change, nothing recorded
    })))
})
