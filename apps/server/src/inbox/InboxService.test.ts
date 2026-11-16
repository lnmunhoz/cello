// Who gets which comment (CEL-15): a human comment on a task goes to the agent session holding its
// claim when it was written. Not the agent's own comments, not other agents', nothing after the claim
// ends. Taking the new items marks them read in the same step, so each one is handed over once, even
// to takers running at the same time.
import type { InboxItem } from "@cello/contract/entities"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as TestClock from "effect/testing/TestClock"
import * as SqlClient from "effect/sql/SqlClient"
import * as CommentService from "../comment/CommentService.ts"
import { ContextService } from "../context/ContextService.ts"
import * as EventStore from "../events/EventStore.ts"
import * as ReviewService from "../review/ReviewService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { writePng } from "../testing/media.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import { SessionService } from "../session/SessionService.ts"
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
const bodies = (items: ReadonlyArray<InboxItem>) =>
  items.map((i) => (i.kind === "answers" || i.kind === "withdrawn" ? `${i.kind}: ${i.ask.title}` : i.kind === "reaction" ? `${i.emoji}: ${i.comment.body}` : i.comment.body))

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
      expect(yield* inbox.take({})).toEqual({ session: null, items: [], earlier: [], claimed: [], human: "Lucas" })
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

  it.effect("delivering writes no event of its own; taking the comment writes one comment.delivered (CEL-76)", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      const store = yield* EventStore.EventStore
      const before = yield* store.latestSeq
      const sent = yield* comment(one.id, "One event: the comment")
      expect((yield* eventsAfter(before)).map((e) => e.type)).toEqual(["comment.added"])
      const taken = yield* agent(inbox.take({}))
      const after = yield* eventsAfter(before + 1)
      expect(after).toEqual([{ type: "comment.delivered", commentId: sent.id, taskId: one.id, session: taken.session!.id, via: "inbox" }])
      // Nothing new: nothing written.
      yield* agent(inbox.take({}))
      expect(yield* store.latestSeq).toBe(before + 2)
    })))
})

/** The events after `seq`: each one's type and payload. */
const eventsAfter = (seq: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ type: string; payload: string }>`SELECT type, payload FROM events WHERE seq > ${seq} ORDER BY seq`.pipe(Effect.orDie)
    return rows.map((r): Record<string, unknown> & { type: string } => ({ ...(JSON.parse(r.payload) as Record<string, unknown>), type: r.type }))
  })

// CEL-76: receipts. Each comment Lucas writes says where it went, and when (and how) that session took it.
describe("InboxService: delivery receipts (CEL-76)", () => {
  it.effect("a comment says which session it went to as it's written, then when and how the session took it", () =>
    run(Effect.gen(function* () {
      const { inbox, comments, one, comment } = yield* setup
      const store = yield* EventStore.EventStore
      const before = yield* store.latestSeq
      const sent = yield* comment(one.id, "Did this reach you?")
      const session = (yield* agent(inbox.take({ unreadOnly: true }))).session!
      // comment.added carries where it went, not taken yet.
      const [added] = yield* eventsAfter(before)
      expect((added as unknown as { comment: { delivery: unknown } }).comment.delivery).toEqual({ sessionId: session.id, readAt: null, via: null })
      expect(sent.delivery).toEqual({ sessionId: session.id, readAt: null, via: null })
      // comment.list reads it back taken.
      const [listed] = yield* comments.list(one.id)
      expect(listed!.delivery).toEqual({ sessionId: session.id, readAt: expect.any(Number), via: "inbox" })
    })))

  it.effect("the hook, cello inbox and a waiter each say how they took it", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      const store = yield* EventStore.EventStore
      const delivered = (seq: number) => eventsAfter(seq).pipe(Effect.map((es) => es.filter((e) => e.type === "comment.delivered").map((e) => e["via"])))

      let seq = yield* store.latestSeq
      yield* comment(one.id, "By the hook")
      yield* agent(inbox.take({ unreadOnly: true, via: "hook" }))
      expect(yield* delivered(seq)).toEqual(["hook"])

      seq = yield* store.latestSeq
      yield* comment(one.id, "By cello inbox")
      yield* agent(inbox.take({ unreadOnly: true }))
      expect(yield* delivered(seq)).toEqual(["inbox"])

      seq = yield* store.latestSeq
      const waiting = yield* Effect.forkChild(agent(inbox.wait))
      yield* Effect.yieldNow
      yield* comment(one.id, "By the waiter")
      yield* Fiber.join(waiting)
      expect(yield* delivered(seq)).toEqual(["wait"])
    })))

  it.effect("a Send back note gets its receipt too; an agent's comment and one on an unclaimed task go to nobody", () =>
    run(Effect.gen(function* () {
      const { inbox, comments, tasks, one, comment } = yield* setup
      const mine = yield* agent(comment(one.id, "My own note"))
      expect(mine.delivery).toBeNull()
      const free = (yield* tasks.create({ commandId: cmd(), projectId: one.projectId, title: "Nobody holds this" })).result
      const nowhere = yield* comment(free.id, "Anyone?")
      expect(nowhere.delivery).toBeNull()
      expect((yield* comments.list(free.id))[0]!.delivery).toBeNull()
      expect(yield* agent(inbox.take({ unreadOnly: true }))).toMatchObject({ items: [] })
    })))

  it.effect("taking answers or a reaction writes no comment.delivered: receipts are for comments", () =>
    run(Effect.gen(function* () {
      const { inbox, comments, one, comment } = yield* setup
      const written = yield* agent(comment(one.id, "Built it"))
      yield* comments.react({ commandId: cmd(), commentId: written.id, emoji: "👍", on: true })
      const store = yield* EventStore.EventStore
      const before = yield* store.latestSeq
      expect((yield* agent(inbox.take({ unreadOnly: true }))).items).toHaveLength(1)
      expect(yield* eventsAfter(before)).toEqual([])
    })))
})

// CEL-76: the server sees a session's `cello inbox --wait` through its open `inbox.wait`, so boards can
// tell a waiting agent (a comment reaches it at once) from an idle one.
describe("InboxService.wait: the session counts as waiting (CEL-76)", () => {
  const waitingEvents = (seq: number) =>
    eventsAfter(seq).pipe(Effect.map((es) => es.filter((e) => e.type === "session.waiting").map((e) => e["waiting"])))

  it.effect("while a wait is open the session is waiting; boards hear it start and stop once, even with two waits", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      const sessions = yield* SessionService
      const store = yield* EventStore.EventStore
      const id = (yield* agent(inbox.take({ unreadOnly: true }))).session!.id
      const seq = yield* store.latestSeq
      expect((yield* sessions.byIds([id]))[0]!.waiting).toBe(false)
      const first = yield* Effect.forkChild(agent(inbox.wait))
      const second = yield* Effect.forkChild(agent(inbox.wait))
      yield* Effect.yieldNow
      expect((yield* sessions.byIds([id]))[0]!.waiting).toBe(true)
      expect(yield* waitingEvents(seq)).toEqual([true])
      yield* comment(one.id, "Wake up")
      yield* Fiber.join(first)
      yield* Fiber.interrupt(second)
      expect((yield* sessions.byIds([id]))[0]!.waiting).toBe(false)
      expect(yield* waitingEvents(seq)).toEqual([true, false])
    })))

  it.effect("a wait that's interrupted (the waiter killed, the connection dropped) stops it waiting", () =>
    run(Effect.gen(function* () {
      const { inbox } = yield* setup
      const sessions = yield* SessionService
      const id = (yield* agent(inbox.take({ unreadOnly: true }))).session!.id
      const waiting = yield* Effect.forkChild(agent(inbox.wait))
      yield* Effect.yieldNow
      expect((yield* sessions.byIds([id]))[0]!.waiting).toBe(true)
      yield* Fiber.interrupt(waiting)
      expect((yield* sessions.byIds([id]))[0]!.waiting).toBe(false)
    })))

  // CEL-76 follow-up: the session wakes the moment its wait hands a comment over, and starts on it. Until
  // its next check-in the board would still see it waiting, last seen when the wait opened (often long
  // ago), and say it got the comment but hasn't answered.
  it.effect("a wait that hands an item over is a sign of life: seen at that moment and not waiting, in the delivery's own change", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      const sessions = yield* SessionService
      const store = yield* EventStore.EventStore
      const sql = yield* SqlClient.SqlClient
      const id = (yield* agent(inbox.take({ unreadOnly: true }))).session!.id
      const waiting = yield* Effect.forkChild(agent(inbox.wait))
      yield* Effect.yieldNow
      const opened = (yield* sessions.byIds([id]))[0]!.lastSeenAt
      // Lucas writes twenty minutes later: well past the board's idle threshold.
      yield* TestClock.adjust("20 minutes")
      const seq = yield* store.latestSeq
      yield* comment(one.id, "Wake up")
      yield* Fiber.join(waiting)

      const rows = yield* sql<{ type: string; ts: number; command_id: string; payload: string }>`
        SELECT type, ts, command_id, payload FROM events WHERE seq > ${seq} AND type IN ('comment.delivered', 'session.seen') ORDER BY seq`
        .pipe(Effect.orDie)
      expect(rows.map((r) => r.type)).toEqual(["comment.delivered", "session.seen"])
      const [delivered, seen] = rows
      // One change: a board never sees the comment taken by a session still waiting, or last seen long ago.
      expect(seen!.command_id).toBe(delivered!.command_id)
      const told = (JSON.parse(seen!.payload) as { session: { id: string; lastSeenAt: number; waiting?: boolean } }).session
      expect(told).toMatchObject({ id, lastSeenAt: delivered!.ts, waiting: false })
      expect(told.lastSeenAt).toBeGreaterThan(opened)
      expect((yield* sessions.byIds([id]))[0]).toMatchObject({ lastSeenAt: delivered!.ts, waiting: false })
    })))

  it.effect("a wait that takes nothing (interrupted) and a plain take say nothing about being seen", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      const store = yield* EventStore.EventStore
      yield* agent(inbox.take({ unreadOnly: true }))
      // The plain take's own call checked in already: its check-in is the middleware's, not take's.
      const seq = yield* store.latestSeq
      const waiting = yield* Effect.forkChild(agent(inbox.wait))
      yield* Effect.yieldNow
      yield* Fiber.interrupt(waiting)
      yield* comment(one.id, "Read it with the hook")
      yield* agent(inbox.take({ unreadOnly: true, via: "hook" }))
      expect((yield* eventsAfter(seq)).filter((e) => e.type === "session.seen")).toEqual([])
    })))

  it.effect("a session holding no claim waits quietly: no board hears it", () =>
    run(Effect.gen(function* () {
      const { inbox, tasks, one } = yield* setup
      yield* agent(tasks.release({ commandId: cmd(), key: one.key }))
      const store = yield* EventStore.EventStore
      const seq = yield* store.latestSeq
      const waiting = yield* Effect.forkChild(agent(inbox.wait))
      yield* Effect.yieldNow
      yield* Fiber.interrupt(waiting)
      expect(yield* waitingEvents(seq)).toEqual([])
    })))
})

describe("InboxService.take: what the session holds (CEL-74)", () => {
  it.effect("says which tasks the session holds a claim on, and the human's name, so the Stop hook can ask it to wait for them", () =>
    run(Effect.gen(function* () {
      const { inbox, tasks, one } = yield* setup
      expect(yield* agent(inbox.take({ unreadOnly: true }))).toMatchObject({ claimed: ["CEL-1"], human: "Lucas" })
      expect((yield* other(inbox.take({ unreadOnly: true }))).claimed).toEqual(["CEL-2"])
      yield* agent(tasks.release({ commandId: cmd(), key: one.key }))
      expect((yield* agent(inbox.take({ unreadOnly: true }))).claimed).toEqual([])
    })))
})

describe("InboxService.wait (CEL-74)", () => {
  it.effect("blocks until a new item arrives, then takes it like take: marked read, handed over once", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      const waiting = yield* Effect.forkChild(agent(inbox.wait))
      yield* Effect.yieldNow
      yield* comment(one.id, "While you were idle")
      const woken = yield* Fiber.join(waiting)
      expect(woken.session?.externalId).toBe("session-x")
      expect(bodies(woken.items)).toEqual(["While you were idle"])
      expect(woken.earlier).toEqual([])
      expect(woken.claimed).toEqual(["CEL-1"])
      expect(yield* agent(inbox.unread)).toEqual([])
    })))

  it.effect("returns at once when items are already waiting", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment } = yield* setup
      yield* comment(one.id, "Already here")
      expect(bodies((yield* agent(inbox.wait)).items)).toEqual(["Already here"])
    })))

  it.effect("other sessions' items and the board's other changes don't wake it", () =>
    run(Effect.gen(function* () {
      const { inbox, tasks, one, two, comment } = yield* setup
      const waiting = yield* Effect.forkChild(agent(inbox.wait))
      yield* Effect.yieldNow
      yield* comment(two.id, "For Y")
      yield* tasks.create({ commandId: cmd(), projectId: one.projectId, title: "Unrelated" })
      yield* comment(one.id, "For X")
      expect(bodies((yield* Fiber.join(waiting)).items)).toEqual(["For X"])
    })))

  it.effect("the human has no inbox: it returns at once, empty", () =>
    run(Effect.gen(function* () {
      const { inbox } = yield* setup
      expect(yield* inbox.wait).toEqual({ session: null, items: [], earlier: [], claimed: [], human: "Lucas" })
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

  it.effect("a comment while the packet waits for review (the Review page's comment box, CEL-70) leaves the task In Review and claimed, and reaches the submitting session", () =>
    run(Effect.gen(function* () {
      const { inbox, tasks, status, one, comment } = yield* submitted
      const before = yield* tasks.byKey(one.key)
      expect(before.assigneeSessionId).not.toBeNull()
      yield* comment(one.id, "Looks right; also check the dark theme")
      const after = yield* tasks.byKey(one.key)
      expect(after.statusId).toBe(status["In Review"]!.id)
      expect(after.assigneeSessionId).toBe(before.assigneeSessionId)
      expect((yield* agent(inbox.unread)).map((i) => [i.kind, i.taskKey, bodies([i])[0]])).toEqual([
        ["comment", "CEL-1", "Looks right; also check the dark theme"],
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

// CEL-77: Lucas reacting to an agent's comment reaches the session that wrote it (the claim holder once
// that session ended), once. Taking the reaction back before it's read takes the item back.
describe("InboxService: reactions", () => {
  /** What each item is: "👍 on <comment body>" for a reaction, else the comment's body. */
  const said = (items: ReadonlyArray<InboxItem>) =>
    items.map((i) => (i.kind === "reaction" ? `${i.emoji} on ${i.comment.body}` : bodies([i])[0]))

  /** Session X's comment on CEL-1, which X claimed. */
  const agentComment = Effect.gen(function* () {
    const ctx = yield* setup
    const written = yield* agent(ctx.comment(ctx.one.id, "Built it; shall I merge?"))
    const react = (emoji: string, on = true) => ctx.comments.react({ commandId: cmd(), commentId: written.id, emoji, on })
    return { ...ctx, written, react }
  })

  it.effect("Lucas's reaction to an agent's comment reaches the session that wrote it, and no one else", () =>
    run(Effect.gen(function* () {
      const { inbox, written, react } = yield* agentComment
      const { result } = yield* react("👍")

      expect(yield* agent(inbox.unread)).toEqual([{
        id: expect.any(String),
        kind: "reaction",
        emoji: "👍",
        taskId: written.taskId,
        taskKey: "CEL-1",
        taskTitle: "Comments reach agents",
        comment: result,
        author: "Lucas",
        createdAt: result.reactions![0]!.createdAt,
        readAt: null,
      }])
      expect(yield* other(inbox.unread)).toEqual([])
    })))

  it.effect("is handed over once, in order with comments, and comes back as earlier", () =>
    run(Effect.gen(function* () {
      const { inbox, one, comment, react } = yield* agentComment
      yield* comment(one.id, "Before the reaction")
      yield* react("👍")
      yield* comment(one.id, "After it")
      const taken = yield* agent(inbox.take({ unreadOnly: true }))
      expect(said(taken.items)).toEqual(["Before the reaction", "👍 on Built it; shall I merge?", "After it"])
      expect(taken.items.every((i) => typeof i.readAt === "number")).toBe(true)
      expect((yield* agent(inbox.take({ unreadOnly: true }))).items).toEqual([])
      expect(said((yield* agent(inbox.take({}))).earlier)).toEqual(["Before the reaction", "👍 on Built it; shall I merge?", "After it"])
    })))

  it.effect("taking the reaction back before it's read takes the item back; reacting again delivers again", () =>
    run(Effect.gen(function* () {
      const { inbox, react } = yield* agentComment
      yield* react("👍")
      yield* react("🎉")
      yield* react("👍", false)
      expect(said(yield* agent(inbox.unread))).toEqual(["🎉 on Built it; shall I merge?"])
      yield* agent(inbox.take({ unreadOnly: true }))
      yield* react("👍")
      expect(said((yield* agent(inbox.take({ unreadOnly: true }))).items)).toEqual(["👍 on Built it; shall I merge?"])
    })))

  it.effect("goes to the claim holder once the session that wrote the comment ended, and to no one when nobody holds it", () =>
    run(Effect.gen(function* () {
      const { inbox, tasks, one, react } = yield* agentComment
      const sql = yield* SqlClient.SqlClient
      yield* agent(tasks.release({ commandId: cmd(), key: one.key }))
      yield* other(tasks.claim({ commandId: cmd(), key: one.key }))
      // While X lives, it's X's even without the claim.
      yield* react("👀")
      yield* sql`UPDATE agent_sessions SET ended_at = 1 WHERE external_id = 'session-x'`
      yield* react("👍")
      expect(said(yield* agent(inbox.unread))).toEqual(["👀 on Built it; shall I merge?"])
      expect(said(yield* other(inbox.unread))).toEqual(["👍 on Built it; shall I merge?"])

      yield* other(tasks.release({ commandId: cmd(), key: one.key }))
      yield* react("🎉")
      expect(said(yield* other(inbox.unread))).toEqual(["👍 on Built it; shall I merge?"])
    })))

  it.effect("agents' reactions, and Lucas's reactions to his own comments, reach no one", () =>
    run(Effect.gen(function* () {
      const { inbox, comments, one, comment, written } = yield* agentComment
      yield* other(comments.react({ commandId: cmd(), commentId: written.id, emoji: "👍", on: true }))
      yield* agent(comments.react({ commandId: cmd(), commentId: written.id, emoji: "🎉", on: true }))
      const his = yield* comment(one.id, "Mine")
      yield* agent(inbox.take({ unreadOnly: true }))
      yield* comments.react({ commandId: cmd(), commentId: his.id, emoji: "👍", on: true })
      expect(yield* agent(inbox.unread)).toEqual([])
      expect(yield* other(inbox.unread)).toEqual([])
    })))

  it.effect("wakes a waiting session; delivering writes no event beyond the reaction's own (and the session waking, and its waiter stopping)", () =>
    run(Effect.gen(function* () {
      const { inbox, react } = yield* agentComment
      const store = yield* EventStore.EventStore
      const waiting = yield* Effect.forkChild(agent(inbox.wait))
      yield* Effect.yieldNow
      const before = yield* store.latestSeq
      yield* react("👍")
      expect(said((yield* Fiber.join(waiting)).items)).toEqual(["👍 on Built it; shall I merge?"])
      expect((yield* eventsAfter(before)).map((e) => e.type)).toEqual(["reaction.added", "session.seen", "session.waiting"])
    })))

  it.effect("cello context shows it without marking it read", () =>
    run(Effect.gen(function* () {
      const { inbox, react } = yield* agentComment
      yield* react("✅")
      const context = yield* ContextService
      expect(said((yield* agent(context.context({ key: "CEL" }))).inbox)).toEqual(["✅ on Built it; shall I merge?"])
      expect(said((yield* agent(inbox.take({ unreadOnly: true }))).items)).toEqual(["✅ on Built it; shall I merge?"])
    })))
})
