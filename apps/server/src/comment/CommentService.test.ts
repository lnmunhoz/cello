import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asHuman, services } from "../testing/TestLayers.ts"
import * as CommentService from "./CommentService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

describe("CommentService", () => {
  it.effect("add, edit, delete; deleted comments leave the list", () =>
    run(Effect.gen(function* () {
      const comments = yield* CommentService.CommentService
      const { project } = yield* setupProject
      const { result: task } = yield* (yield* TaskService.TaskService).create({ commandId: cmd(), projectId: project.id, title: "T" })

      const { result: first } = yield* comments.add({ commandId: cmd(), taskId: task.id, body: "First" })
      yield* comments.add({ commandId: cmd(), taskId: task.id, body: "Second" })
      yield* comments.edit({ commandId: cmd(), id: first.id, body: "First, edited" })
      expect((yield* comments.list(task.id)).map((c) => c.body)).toEqual(["First, edited", "Second"])

      const deleted = yield* comments.remove({ commandId: cmd(), id: first.id })
      expect(deleted.result.deletedAt).not.toBeNull()
      expect((yield* comments.list(task.id)).map((c) => c.body)).toEqual(["Second"])
      expect(yield* Effect.flip(comments.edit({ commandId: cmd(), id: first.id, body: "x" }))).toMatchObject({
        _tag: "NotFound",
      })
    })))

  it.effect("an empty body is Invalid; an unknown task is NotFound", () =>
    run(Effect.gen(function* () {
      const comments = yield* CommentService.CommentService
      expect(yield* Effect.flip(comments.add({ commandId: cmd(), taskId: "nope", body: " " }))).toMatchObject({
        _tag: "Invalid",
      })
      expect(yield* Effect.flip(comments.add({ commandId: cmd(), taskId: "nope", body: "hi" }))).toMatchObject({
        _tag: "NotFound",
        entity: "task",
      })
      expect(yield* Effect.flip(comments.list("nope"))).toMatchObject({ _tag: "NotFound" })
    })))
})
