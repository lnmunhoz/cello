import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"
import * as EventStore from "../events/EventStore.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
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

  // CEL-5 follow-up: a card said "changed 45m ago" right after a new comment.
  describe("a comment is activity on its task", () => {
    const builder = { session: "session-builder", client: "Claude Code", pid: process.pid }

    /** A task the builder session claimed, then a minute passes. */
    const claimed = Effect.gen(function* () {
      const tasks = yield* TaskService.TaskService
      const { project, status } = yield* setupProject
      const { result: task } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "T", statusId: status["Todo"]!.id })
      const { result } = yield* asAgent(builder)(tasks.claim({ commandId: cmd(), key: task.key }))
      yield* TestClock.adjust("1 minute")
      return { tasks, task: result }
    })

    it.effect("adding one sets the task's last change to the commenter at the comment's time, counts it, and keeps the claim", () =>
      run(Effect.gen(function* () {
        const comments = yield* CommentService.CommentService
        const { tasks, task } = yield* claimed
        expect(task).toMatchObject({ commentCount: 0, lastCommentAt: null })

        // The agent comments: the change is its session's.
        const { result: mine } = yield* asAgent(builder)(comments.add({ commandId: cmd(), taskId: task.id, body: "Progress" }))
        expect(mine.createdAt).toBeGreaterThan(task.updatedAt)
        expect(yield* tasks.byKey(task.key)).toMatchObject({
          updatedAt: mine.createdAt,
          updatedByActorId: mine.actorId,
          updatedBySessionId: task.assigneeSessionId,
          version: task.version + 1,
          commentCount: 1,
          lastCommentAt: mine.createdAt,
        })

        // Lucas comments on the agent's claimed task: his activity, not him taking it over.
        yield* TestClock.adjust("1 minute")
        const { result: his } = yield* comments.add({ commandId: cmd(), taskId: task.id, body: "Looks good" })
        expect(yield* tasks.byKey(task.key)).toMatchObject({
          updatedAt: his.createdAt,
          updatedByActorId: his.actorId,
          updatedBySessionId: null,
          commentCount: 2,
          lastCommentAt: his.createdAt,
          assigneeActorId: task.assigneeActorId,
          assigneeSessionId: task.assigneeSessionId,
          statusId: task.statusId,
        })
        // No task event: the comment's own event is the change, and nothing ended the claim.
        const history = yield* (yield* EventStore.EventStore).history(task.id)
        expect(history.map((e) => e.type)).toEqual(["task.created", "task.claimed"])
      })))

    it.effect("editing one is activity too; deleting one is a change, and the count drops", () =>
      run(Effect.gen(function* () {
        const comments = yield* CommentService.CommentService
        const { tasks, task } = yield* claimed
        const { result: first } = yield* comments.add({ commandId: cmd(), taskId: task.id, body: "First" })
        yield* comments.add({ commandId: cmd(), taskId: task.id, body: "Second" })

        yield* TestClock.adjust("1 minute")
        const { result: edited } = yield* asAgent(builder)(comments.edit({ commandId: cmd(), id: first.id, body: "First, edited" }))
        const afterEdit = yield* tasks.byKey(task.key)
        expect(afterEdit).toMatchObject({
          updatedAt: edited.updatedAt,
          lastCommentAt: edited.updatedAt,
          commentCount: 2,
          updatedBySessionId: task.assigneeSessionId,
        })

        // An edit that changes nothing is no activity.
        yield* TestClock.adjust("1 minute")
        yield* comments.edit({ commandId: cmd(), id: first.id, body: "First, edited" })
        expect((yield* tasks.byKey(task.key)).version).toBe(afterEdit.version)

        const { result: deleted } = yield* comments.remove({ commandId: cmd(), id: first.id })
        const afterDelete = yield* tasks.byKey(task.key)
        expect(afterDelete).toMatchObject({ updatedAt: deleted.deletedAt, updatedBySessionId: null, commentCount: 1 })
        // The latest activity is the deletion now, not a comment.
        expect(afterDelete.lastCommentAt).toBeLessThan(afterDelete.updatedAt)
        expect(afterDelete.assigneeSessionId).toBe(task.assigneeSessionId)
      })))
  })
})

// CEL-77: emoji reactions. One per reacting party (the human, or an agent session) and emoji; `on: false`
// removes it. Every change is an event; a reaction is no activity on the task and never ends a claim.
describe("CommentService.react", () => {
  const builder = { session: "session-builder", client: "Claude Code", pid: process.pid }
  const reactions = (c: { readonly reactions?: ReadonlyArray<{ emoji: string; sessionId: string | null }> | undefined }) =>
    (c.reactions ?? []).map((r) => `${r.emoji} ${r.sessionId === null ? "human" : "agent"}`)

  /** A task the builder session claimed, with a comment from it. */
  const commented = Effect.gen(function* () {
    const tasks = yield* TaskService.TaskService
    const comments = yield* CommentService.CommentService
    const { project, status } = yield* setupProject
    const { result: created } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "T", statusId: status["Todo"]!.id })
    yield* asAgent(builder)(tasks.claim({ commandId: cmd(), key: created.key }))
    const { result: comment } = yield* asAgent(builder)(comments.add({ commandId: cmd(), taskId: created.id, body: "Built it; shall I merge?" }))
    yield* TestClock.adjust("1 minute")
    return { tasks, comments, comment, task: yield* tasks.byKey(created.key) }
  })

  it.effect("toggles on and off; adding it again keeps one; each party and emoji is its own; the list carries them", () =>
    run(Effect.gen(function* () {
      const { comments, comment, task } = yield* commented
      const react = (emoji: string, on = true) => comments.react({ commandId: cmd(), commentId: comment.id, emoji, on })

      const first = yield* react("👍")
      expect(first.seq).not.toBeNull()
      expect(reactions(first.result)).toEqual(["👍 human"])
      expect(first.result.reactions![0]).toMatchObject({ commentId: comment.id, taskId: task.id, emoji: "👍", sessionId: null })

      // Again: still one, and no event.
      const again = yield* react("👍")
      expect(again.seq).toBeNull()
      expect(reactions(again.result)).toEqual(["👍 human"])

      yield* asAgent(builder)(react("👍"))
      yield* react(" 🎉 ")
      expect(reactions((yield* comments.list(task.id))[0]!)).toEqual(["👍 human", "👍 agent", "🎉 human"])

      const off = yield* react("👍", false)
      expect(off.seq).not.toBeNull()
      expect(reactions(off.result)).toEqual(["👍 agent", "🎉 human"])
      // Removing one that isn't there: nothing happens.
      expect((yield* react("👀", false)).seq).toBeNull()

      const store = yield* EventStore.EventStore
      const events = (yield* store.readAfter({ workspaceId: "", projectId: task.projectId }, 0)).filter((e) => e.type.startsWith("reaction."))
      expect(events.map((e) => [e.type, e.type === "reaction.added" || e.type === "reaction.removed" ? e.reaction.emoji : "", e.sessionId === null]))
        .toEqual([
          ["reaction.added", "👍", true],
          ["reaction.added", "👍", false],
          ["reaction.added", "🎉", true],
          ["reaction.removed", "👍", true],
        ])
    })))

  it.effect("is no activity on the task: its version, last change and claim stay", () =>
    run(Effect.gen(function* () {
      const { tasks, comments, comment, task } = yield* commented
      yield* comments.react({ commandId: cmd(), commentId: comment.id, emoji: "👍", on: true })
      yield* comments.react({ commandId: cmd(), commentId: comment.id, emoji: "👍", on: false })
      expect(yield* tasks.byKey(task.key)).toEqual(task)
      const history = yield* (yield* EventStore.EventStore).history(task.id)
      expect(history.map((e) => e.type)).toEqual(["task.created", "task.claimed"])
    })))

  it.effect("something that isn't one emoji is Invalid; an unknown or deleted comment is NotFound", () =>
    run(Effect.gen(function* () {
      const { comments, comment } = yield* commented
      const react = (commentId: string, emoji: string) => Effect.flip(comments.react({ commandId: cmd(), commentId, emoji, on: true }))
      expect(yield* react(comment.id, "ok")).toMatchObject({ _tag: "Invalid", field: "emoji", reason: "a reaction must be one emoji, like 👍" })
      expect(yield* react(comment.id, "")).toMatchObject({ _tag: "Invalid", field: "emoji" })
      expect(yield* react("nope", "👍")).toMatchObject({ _tag: "NotFound", entity: "comment" })
      yield* comments.remove({ commandId: cmd(), id: comment.id })
      expect(yield* react(comment.id, "👍")).toMatchObject({ _tag: "NotFound", entity: "comment" })
    })))
})
