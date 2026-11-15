// Who gets which comment (CEL-15): a human comment on a task goes to the agent session holding its
// claim when it was written. Not the agent's own comments, not other agents', nothing after the claim
// ends. Taking the new items marks them read in the same step, so each one is handed over once, even
// to takers running at the same time.
import type { InboxItem } from "@cello/contract/entities"
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

/** What each item says: a comment's body, or the kind and title of the ask an answers or withdrawn item is about. */
const bodies = (items: ReadonlyArray<InboxItem>) => items.map((i) => (i.kind === "answers" || i.kind === "withdrawn" ? `${i.kind}: ${i.ask.title}` : i.comment.body))

describe("InboxService: who gets what", () => {
  it.effect("a human comment on a task goes to the session holding its claim, and to no one else", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      const written = yield* comment(one.id, "Also handle the empty state: https://example.com/spec")

      expect(yield* agent(inbox.unread)).toEqual([{
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
      expect(yield* other(inbox.unread)).toEqual([])
      // The human has no inbox.
      expect(yield* inbox.unread).toEqual([])
      expect(yield* inbox.take({})).toEqual({ session: null, items: [], earlier: [] })
    })))

  it.effect("the agent's own comments and other agents' comments aren't delivered", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      yield* agent(comment(one.id, "Started on it"))
      yield* other(comment(one.id, "I looked at this too"))
      expect(yield* agent(inbox.unread)).toEqual([])
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

      expect(bodies(yield* agent(inbox.unread))).toEqual(["While you hold it"])
      expect(yield* other(inbox.unread)).toEqual([])
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

      expect(bodies(yield* agent(inbox.unread))).toEqual(["First"])
      expect(bodies(yield* other(inbox.unread))).toEqual(["Second"])
    })))

  it.effect("an edited comment shows its new text; a deleted one drops out", () =>
    run(Effect.gen(function* () {
      const { inbox, comments, one, comment } = yield* setup
      const first = yield* comment(one.id, "Typo hre")
      const second = yield* comment(one.id, "Never mind")
      yield* comments.edit({ commandId: cmd(), id: first.id, body: "Typo here" })
      yield* comments.remove({ commandId: cmd(), id: second.id })
      expect(bodies(yield* agent(inbox.unread))).toEqual(["Typo here"])
    })))
})

describe("InboxService.take", () => {
  it.effect("hands over the new items and marks them read in one step; the next take gets nothing new", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      yield* comment(one.id, "One")
      yield* comment(one.id, "Two")

      const first = yield* agent(inbox.take({ unreadOnly: true }))
      expect(first.session?.externalId).toBe("session-x")
      expect(bodies(first.items)).toEqual(["One", "Two"])
      expect(first.items.every((i) => typeof i.readAt === "number")).toBe(true)
      expect(first.earlier).toEqual([])

      expect((yield* agent(inbox.take({ unreadOnly: true }))).items).toEqual([])
      expect(yield* agent(inbox.unread)).toEqual([])
    })))

  it.effect("without unreadOnly it also returns what was read before, as earlier", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      yield* comment(one.id, "Old")
      yield* agent(inbox.take({ unreadOnly: true }))
      yield* comment(one.id, "New")
      const all = yield* agent(inbox.take({}))
      expect(bodies(all.items)).toEqual(["New"])
      expect(bodies(all.earlier)).toEqual(["Old"])
      expect(all.earlier[0]!.readAt).toEqual(expect.any(Number))
    })))

  it.effect("a session takes only its own items", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      yield* comment(one.id, "For X")
      expect((yield* other(inbox.take({}))).items).toEqual([])
      expect((yield* inbox.take({})).items).toEqual([])
      expect(bodies(yield* agent(inbox.unread))).toEqual(["For X"])
    })))

  it.effect("two takes at the same time: each item goes to exactly one of them", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      yield* comment(one.id, "Once")
      yield* comment(one.id, "Only once")
      const takes = yield* Effect.all([agent(inbox.take({ unreadOnly: true })), agent(inbox.take({ unreadOnly: true }))], {
        concurrency: "unbounded",
      })
      expect(takes.flatMap((t) => bodies(t.items)).sort()).toEqual(["Once", "Only once"])
    })))

  it.effect("delivering and taking write no events: the board doesn't change", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      const store = yield* EventStore.EventStore
      const before = yield* store.latestSeq
      yield* comment(one.id, "One event: the comment")
      expect(yield* store.latestSeq).toBe(before + 1)
      yield* agent(inbox.take({}))
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
      expect((yield* agent(inbox.unread)).map((i) => [i.kind, i.taskKey, bodies([i])[0], i.author])).toEqual([
        ["send_back", "CEL-1", "The video is missing", "Lucas"],
      ])
    })))

  it.effect("it still reaches the session that submitted the packet when a human change ended the claim during review", () =>
    run(Effect.gen(function* () {
      const { inbox, reviews, tasks, one } = yield* submitted
      const current = (yield* tasks.byKey(one.key))
      yield* tasks.update({ commandId: cmd(), id: one.id, expectedVersion: current.version, title: "Comments reach agents (renamed)" })
      expect((yield* tasks.byKey(one.key)).assigneeSessionId).toBeNull()
      yield* reviews.sendBack({ commandId: cmd(), key: one.key, note: "Still missing the video" })
      expect(bodies(yield* agent(inbox.unread))).toEqual(["Still missing the video"])
      // A plain comment on the unclaimed task doesn't.
      yield* (yield* CommentService.CommentService).add({ commandId: cmd(), taskId: one.id, body: "And this?" })
      expect(bodies(yield* agent(inbox.unread))).toEqual(["Still missing the video"])
    })))
})

describe("ContextService.context: the inbox", () => {
  it.effect("shows the session's new comments without marking them read (a subagent running it eats nothing)", () =>
    run(Effect.gen(function* () {
      const { one, comment, inbox } = yield* setup
      yield* comment(one.id, "Please add a test")
      const context = yield* ContextService
      const shown = (yield* agent(context.context({ key: "CEL" }))).inbox
      expect(shown.map((i) => [i.taskKey, bodies([i])[0], i.readAt])).toEqual([["CEL-1", "Please add a test", null]])
      expect((yield* agent(context.context({ key: "CEL" }))).inbox).toEqual(shown)
      expect(bodies((yield* agent(inbox.take({ unreadOnly: true }))).items)).toEqual(["Please add a test"])
      expect((yield* agent(context.context({ key: "CEL" }))).inbox).toEqual([])
      expect((yield* context.context({ key: "CEL" })).inbox).toEqual([])
    })))
})
