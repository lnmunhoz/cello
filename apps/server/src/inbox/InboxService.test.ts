// Who gets which comment (CEL-15): a human comment on a task goes to the agent session holding its
// claim when it was written. Not the agent's own comments, not other agents', nothing after the claim
// ends. Read marks belong to the session and drop items out of "new".
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as CommentService from "../comment/CommentService.ts"
import { ContextService } from "../context/ContextService.ts"
import * as EventStore from "../events/EventStore.ts"
import * as ReviewService from "../review/ReviewService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { writePng } from "../testing/media.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as InboxService from "./InboxService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  asHuman(effect).pipe(Effect.provide(services({ ffmpeg: null })), Effect.scoped) as Effect.Effect<A, E>

const agent = asAgent({ session: "session-x", client: "Claude Code", pid: process.pid })
const other = asAgent({ session: "session-y", client: "Claude Code", pid: process.pid })

/** Project CEL with CEL-1 claimed by session X and CEL-2 claimed by session Y. */
const setup = Effect.gen(function* () {
  const tasks = yield* TaskService.TaskService
  const comments = yield* CommentService.CommentService
  const inbox = yield* InboxService.InboxService
  const { status, project } = yield* setupProject
  const create = (title: string) =>
    tasks.create({ commandId: cmd(), projectId: project.id, title, statusId: status["Todo"]!.id }).pipe(Effect.map((w) => w.result))
  const one = yield* create("Comments reach agents")
  const two = yield* create("Someone else's task")
  yield* agent(tasks.claim({ commandId: cmd(), key: one.key }))
  yield* other(tasks.claim({ commandId: cmd(), key: two.key }))
  const comment = (taskId: string, body: string) => comments.add({ commandId: cmd(), taskId, body }).pipe(Effect.map((w) => w.result))
  return { tasks, comments, inbox, status, project, one, two, comment }
})

const bodies = (inbox: { readonly items: ReadonlyArray<{ readonly comment: { readonly body: string } }> }) =>
  inbox.items.map((i) => i.comment.body)

describe("InboxService: who gets what", () => {
  it.effect("a human comment on a task goes to the session holding its claim, and to no one else", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      const written = yield* comment(one.id, "Also handle the empty state: https://example.com/spec")

      const mine = yield* agent(inbox.list({ unreadOnly: true }))
      expect(mine.session?.externalId).toBe("session-x")
      expect(mine.unread).toBe(1)
      expect(mine.items).toEqual([{
        id: expect.any(String),
        kind: "comment",
        taskId: one.id,
        taskKey: "CEL-1",
        taskTitle: "Comments reach agents",
        comment: written,
        author: "Lucas",
        createdAt: written.createdAt,
        readAt: null,
      }])

      expect((yield* other(inbox.list({}))).items).toEqual([])
      // The human has no inbox.
      expect(yield* inbox.list({})).toEqual({ session: null, items: [], unread: 0 })
    })))

  it.effect("the agent's own comments and other agents' comments aren't delivered", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      yield* agent(comment(one.id, "Started on it"))
      yield* other(comment(one.id, "I looked at this too"))
      expect((yield* agent(inbox.list({}))).items).toEqual([])
    })))

  it.effect("nothing reaches a session after its claim ends; what came during the claim stays", () =>
    run(Effect.gen(function* () {
      const { inbox, tasks, status, one, two, comment } = yield* setup
      yield* comment(one.id, "While you hold it")
      yield* agent(tasks.release({ commandId: cmd(), key: one.key }))
      yield* comment(one.id, "After you let it go")
      // A human change ends Y's claim; the comment after it goes nowhere.
      yield* tasks.move({ commandId: cmd(), id: two.id, statusId: status["Todo"]!.id })
      yield* comment(two.id, "After I moved it back")

      expect(bodies(yield* agent(inbox.list({ unreadOnly: true })))).toEqual(["While you hold it"])
      expect((yield* other(inbox.list({}))).items).toEqual([])
    })))

  it.effect("a comment follows the claim when another session takes it over", () =>
    run(Effect.gen(function* () {
      const { inbox, tasks, one, comment } = yield* setup
      yield* comment(one.id, "First")
      // The human takes the claim, then hands it to Y by releasing it; Y claims it.
      yield* tasks.claim({ commandId: cmd(), key: one.key })
      yield* comment(one.id, "Mine for now")
      yield* tasks.release({ commandId: cmd(), key: one.key })
      yield* other(tasks.claim({ commandId: cmd(), key: one.key }))
      yield* comment(one.id, "Second")

      expect(bodies(yield* agent(inbox.list({})))).toEqual(["First"])
      expect(bodies(yield* other(inbox.list({})))).toEqual(["Second"])
    })))

  it.effect("an edited comment shows its new text; a deleted one drops out", () =>
    run(Effect.gen(function* () {
      const { inbox, comments, one, comment } = yield* setup
      const first = yield* comment(one.id, "Typo hre")
      const second = yield* comment(one.id, "Never mind")
      yield* comments.edit({ commandId: cmd(), id: first.id, body: "Typo here" })
      yield* comments.remove({ commandId: cmd(), id: second.id })
      const list = yield* agent(inbox.list({}))
      expect(bodies(list)).toEqual(["Typo here"])
      expect(list.unread).toBe(1)
    })))
})

describe("InboxService: read marks", () => {
  it.effect("marking items read takes them out of new; the full list keeps them with when they were read", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      yield* comment(one.id, "One")
      yield* comment(one.id, "Two")
      const fresh = yield* agent(inbox.list({ unreadOnly: true }))
      expect(fresh.unread).toBe(2)

      expect(yield* agent(inbox.markRead([fresh.items[0]!.id]))).toEqual({ marked: 1 })
      const after = yield* agent(inbox.list({ unreadOnly: true }))
      expect(bodies(after)).toEqual(["Two"])
      expect(after.unread).toBe(1)

      const all = yield* agent(inbox.list({}))
      expect(bodies(all)).toEqual(["One", "Two"])
      expect(all.items[0]!.readAt).toEqual(expect.any(Number))
      expect(all.items[1]!.readAt).toBeNull()

      // Marking again is harmless and changes nothing.
      expect(yield* agent(inbox.markRead([fresh.items[0]!.id]))).toEqual({ marked: 0 })
    })))

  it.effect("a session can only mark its own items", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      yield* comment(one.id, "For X")
      const [item] = (yield* agent(inbox.list({}))).items
      expect(yield* other(inbox.markRead([item!.id]))).toEqual({ marked: 0 })
      expect(yield* inbox.markRead([item!.id])).toEqual({ marked: 0 })
      expect((yield* agent(inbox.list({ unreadOnly: true }))).unread).toBe(1)
    })))

  it.effect("delivering and reading write no events: the board doesn't change", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      const store = yield* EventStore.EventStore
      const before = yield* store.latestSeq
      yield* comment(one.id, "One event: the comment")
      expect(yield* store.latestSeq).toBe(before + 1)
      const { items } = yield* agent(inbox.list({}))
      yield* agent(inbox.markRead(items.map((i) => i.id)))
      expect(yield* store.latestSeq).toBe(before + 1)
    })))
})

describe("InboxService: Send back", () => {
  /** CEL-1 handed in for review by session X. */
  const submitted = Effect.gen(function* () {
    const ctx = yield* setup
    const reviews = yield* ReviewService.ReviewService
    const png = writePng(yield* tempDataDir, "board.png")
    yield* agent(reviews.submit({ commandId: cmd(), key: ctx.one.key, summary: "Done", steps: ["Look"], files: [{ path: png }], links: [] }))
    return { ...ctx, reviews }
  })

  it.effect("the note lands in the claiming session's inbox, marked as a send back", () =>
    run(Effect.gen(function* () {
      const { inbox, reviews, one } = yield* submitted
      yield* reviews.sendBack({ commandId: cmd(), key: one.key, note: "The video is missing" })
      const { items } = yield* agent(inbox.list({ unreadOnly: true }))
      expect(items.map((i) => [i.kind, i.taskKey, i.comment.body, i.author])).toEqual([["send_back", "CEL-1", "The video is missing", "Lucas"]])
    })))

  it.effect("it still reaches the session that submitted the packet when a human change ended the claim during review", () =>
    run(Effect.gen(function* () {
      const { inbox, reviews, tasks, one } = yield* submitted
      const current = (yield* tasks.byKey(one.key))
      yield* tasks.update({ commandId: cmd(), id: one.id, expectedVersion: current.version, title: "Comments reach agents (renamed)" })
      expect((yield* tasks.byKey(one.key)).assigneeSessionId).toBeNull()
      yield* reviews.sendBack({ commandId: cmd(), key: one.key, note: "Still missing the video" })
      expect(bodies(yield* agent(inbox.list({})))).toEqual(["Still missing the video"])
      // A plain comment on the unclaimed task doesn't.
      yield* (yield* CommentService.CommentService).add({ commandId: cmd(), taskId: one.id, body: "And this?" })
      expect(bodies(yield* agent(inbox.list({})))).toEqual(["Still missing the video"])
    })))
})

describe("ContextService.context: the inbox", () => {
  it.effect("shows the session's new comments", () =>
    run(Effect.gen(function* () {
      const { one, comment, inbox } = yield* setup
      yield* comment(one.id, "Please add a test")
      const ctx = yield* agent((yield* ContextService).context({ key: "CEL" }))
      expect(ctx.inbox.map((i) => [i.taskKey, i.comment.body, i.readAt])).toEqual([["CEL-1", "Please add a test", null]])
      yield* agent(inbox.markRead(ctx.inbox.map((i) => i.id)))
      expect((yield* agent((yield* ContextService).context({ key: "CEL" }))).inbox).toEqual([])
      expect((yield* (yield* ContextService).context({ key: "CEL" })).inbox).toEqual([])
    })))
})
