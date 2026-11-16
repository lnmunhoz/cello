import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"
import * as EventStore from "../events/EventStore.ts"
import * as InboxService from "../inbox/InboxService.ts"
import * as AssetStore from "../review/AssetStore.ts"
import * as ReviewService from "../review/ReviewService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { writePng, writeText } from "../testing/media.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as Drafts from "../upload/drafts.ts"
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

// CEL-73: screenshots in comments. Lucas pastes or drops them into the comment box: each is uploaded at
// once as a draft of the task's box (no event), and sending the comment links them to it. An agent
// attaches image files by path. The comment.added event carries the screenshots.
describe("CommentService screenshots", () => {
  const runWithFiles = <A, E>(effect: Effect.Effect<A, E, any>) =>
    asHuman(effect).pipe(Effect.provide(services({ ffmpeg: null })), Effect.scoped) as Effect.Effect<A, E>
  const agent = asAgent({ session: "session-builder", client: "Claude Code", pid: process.pid })
  const png = new Uint8Array(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEklEQVR4nGOMzrzAwMDAwgAGABKzAZrvMEpfAAAAAElFTkSuQmCC",
    "base64",
  ))

  /** A task the builder session claimed. */
  const setup = Effect.gen(function* () {
    const tasks = yield* TaskService.TaskService
    const comments = yield* CommentService.CommentService
    const { project, status } = yield* setupProject
    const { result: created } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Paste", statusId: status["Todo"]!.id })
    const { result: task } = yield* agent(tasks.claim({ commandId: cmd(), key: created.key }))
    return { tasks, comments, task, project, status }
  })

  it.effect("pasted screenshots upload as drafts; sending the comment takes the ones it names, in the order pasted, and its event carries them", () =>
    runWithFiles(Effect.gen(function* () {
      const { comments, task } = yield* setup
      const one = yield* comments.upload({ taskId: task.id, name: "image.png", bytes: png })
      const two = yield* comments.upload({ taskId: task.id, name: "drop.webp", bytes: png })
      const unused = yield* comments.upload({ taskId: task.id, name: "unused.png", bytes: png })
      expect(one).toMatchObject({ kind: "image", name: "image.png", mime: "image/png", taskId: task.id, askId: null, reviewId: null, sessionId: null, bytes: png.byteLength })

      const { result } = yield* comments.add({ commandId: cmd(), taskId: task.id, body: "Like this", attachmentIds: [two.id, one.id] })
      expect(result.attachments!.map((a) => [a.id, a.mime, a.taskId])).toEqual([[one.id, "image/png", task.id], [two.id, "image/webp", task.id]])
      expect((yield* comments.list(task.id))[0]!.attachments!.map((a) => a.id)).toEqual([one.id, two.id])
      const [added] = yield* (yield* EventStore.EventStore).history(result.id)
      expect(added?.type === "comment.added" && added.comment.attachments!.map((a) => a.id)).toEqual([one.id, two.id])
      // The file is served like any other attachment.
      const stored = yield* (yield* ReviewService.ReviewService).file(one.id, "original")
      expect(new Uint8Array(fs.readFileSync(stored.path))).toEqual(png)
      // Used once: the next comment can't take them again; the unused draft still can be.
      expect(yield* Effect.flip(comments.add({ commandId: cmd(), taskId: task.id, body: "Again", attachmentIds: [one.id] })))
        .toMatchObject({ _tag: "Invalid", field: "attachmentIds" })
      const { result: later } = yield* comments.add({ commandId: cmd(), taskId: task.id, body: "", attachmentIds: [unused.id] })
      expect(later.attachments!.map((a) => a.id)).toEqual([unused.id])
    })))

  it.effect("refuses a screenshot that isn't a draft of this task's box, or is named twice, and writes nothing", () =>
    runWithFiles(Effect.gen(function* () {
      const { comments, tasks, task, project } = yield* setup
      const { result: otherTask } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Other" })
      const theirs = yield* comments.upload({ taskId: otherTask.id, name: "theirs.png", bytes: png })
      const mine = yield* comments.upload({ taskId: task.id, name: "mine.png", bytes: png })
      expect(yield* Effect.flip(comments.add({ commandId: cmd(), taskId: task.id, body: "x", attachmentIds: [theirs.id] })))
        .toMatchObject({ _tag: "Invalid", field: "attachmentIds" })
      expect(yield* Effect.flip(comments.add({ commandId: cmd(), taskId: task.id, body: "x", attachmentIds: [mine.id, mine.id] })))
        .toMatchObject({ _tag: "Invalid", field: "attachmentIds" })
      expect(yield* Effect.flip(comments.add({ commandId: cmd(), taskId: task.id, body: "x", attachmentIds: ["nope"] })))
        .toMatchObject({ _tag: "Invalid", field: "attachmentIds" })
      // Only the human sends his drafts.
      expect(yield* Effect.flip(agent(comments.add({ commandId: cmd(), taskId: task.id, body: "x", attachmentIds: [mine.id] }))))
        .toMatchObject({ _tag: "Invalid", field: "attachmentIds" })
      expect(yield* comments.list(task.id)).toEqual([])
    })))

  it.effect("a comment needs words or a screenshot", () =>
    runWithFiles(Effect.gen(function* () {
      const { comments, task } = yield* setup
      expect(yield* Effect.flip(comments.add({ commandId: cmd(), taskId: task.id, body: "  ", attachmentIds: [] }))).toMatchObject({ _tag: "Invalid", field: "body" })
      const shot = yield* comments.upload({ taskId: task.id, name: "a.png", bytes: png })
      const { result } = yield* comments.add({ commandId: cmd(), taskId: task.id, body: "  ", attachmentIds: [shot.id] })
      expect(result).toMatchObject({ body: "" })
    })))

  it.effect("an agent attaches image files by path: they're copied in; anything but an image is refused", () =>
    runWithFiles(Effect.gen(function* () {
      const { comments, task } = yield* setup
      const dir = yield* tempDataDir
      const { result } = yield* agent(comments.add({ commandId: cmd(), taskId: task.id, body: "The empty state", files: [{ path: writePng(dir, "empty.png") }] }))
      expect(result.attachments!.map((a) => [a.name, a.kind, a.mime, a.sessionId === null])).toEqual([["empty.png", "image", "image/png", false]])
      const stored = yield* (yield* ReviewService.ReviewService).file(result.attachments![0]!.id, "original")
      expect(stored.path.startsWith((yield* AssetStore.AssetStore).dir)).toBe(true)
      expect(yield* Effect.flip(agent(comments.add({ commandId: cmd(), taskId: task.id, body: "x", files: [{ path: writeText(dir, "notes.txt", "hi") }] }))))
        .toMatchObject({ _tag: "Invalid", field: "files", reason: "notes.txt isn't an image (PNG, JPEG, GIF, WebP or AVIF)" })
      expect(yield* Effect.flip(agent(comments.add({ commandId: cmd(), taskId: task.id, body: "x", files: [{ path: path.join(dir, "gone.png") }] }))))
        .toMatchObject({ _tag: "Invalid", field: "files" })
      expect((yield* comments.list(task.id)).length).toBe(1)
    })))

  it.effect("a human comment with screenshots reaches the claiming session's inbox with them", () =>
    runWithFiles(Effect.gen(function* () {
      const { comments, task } = yield* setup
      const shot = yield* comments.upload({ taskId: task.id, name: "look.png", bytes: png })
      yield* comments.add({ commandId: cmd(), taskId: task.id, body: "Look", attachmentIds: [shot.id] })
      const { items } = yield* agent((yield* InboxService.InboxService).take({ unreadOnly: true }))
      expect(items).toHaveLength(1)
      expect(items[0]!.kind === "comment" && items[0]!.comment.attachments!.map((a) => a.id)).toEqual([shot.id])
    })))

  it.effect("Send back from the Review page carries the screenshots pasted with its note", () =>
    runWithFiles(Effect.gen(function* () {
      const { comments, task } = yield* setup
      const dir = yield* tempDataDir
      const reviews = yield* ReviewService.ReviewService
      yield* agent(reviews.submit({ commandId: cmd(), key: task.key, summary: "Done", steps: ["Look"], files: [{ path: writePng(dir) }], links: [] }))
      const shot = yield* comments.upload({ taskId: task.id, name: "overlap.png", bytes: png })
      yield* reviews.sendBack({ commandId: cmd(), key: task.key, note: "They overlap", attachmentIds: [shot.id] })
      const [note] = yield* comments.list(task.id)
      expect(note).toMatchObject({ body: "They overlap" })
      expect(note!.attachments!.map((a) => a.id)).toEqual([shot.id])
    })))

  it.effect("Approve with screenshots in the box posts them as a comment with the typed text, then approves, in one command", () =>
    runWithFiles(Effect.gen(function* () {
      const { comments, tasks, task, status } = yield* setup
      const dir = yield* tempDataDir
      const reviews = yield* ReviewService.ReviewService
      yield* agent(reviews.submit({ commandId: cmd(), key: task.key, summary: "Done", steps: ["Look"], files: [{ path: writePng(dir) }], links: [] }))
      const shot = yield* comments.upload({ taskId: task.id, name: "nice.png", bytes: png })
      const commandId = cmd()
      yield* reviews.approve({ commandId, key: task.key, note: "Ship it, and keep this spacing", attachmentIds: [shot.id] })
      const [posted] = yield* comments.list(task.id)
      expect(posted).toMatchObject({ body: "Ship it, and keep this spacing" })
      expect(posted!.attachments!.map((a) => a.id)).toEqual([shot.id])
      // The text went with the screenshots, so the approval itself carries no note.
      const [review] = yield* reviews.list(task.id)
      expect(review).toMatchObject({ decision: "approved", decisionNote: null })
      expect((yield* tasks.byKey(task.key)).statusId).toBe(status["Done"]!.id)
      // The agent that held the task hears it, like any comment (and nothing about the approval ending its claim, CEL-46).
      const { items } = yield* agent((yield* InboxService.InboxService).take({ unreadOnly: true }))
      expect(items.map((i) => (i.kind === "comment" ? i.comment.id : i.kind))).toEqual([posted!.id])
      // A bad screenshot refuses the whole approval.
      const { result: other } = yield* tasks.create({ commandId: cmd(), projectId: task.projectId, title: "Other", statusId: status["Todo"]!.id })
      yield* agent(tasks.claim({ commandId: cmd(), key: other.key }))
      yield* agent(reviews.submit({ commandId: cmd(), key: other.key, summary: "Done", steps: ["Look"], files: [{ path: writePng(dir) }], links: [] }))
      expect(yield* Effect.flip(reviews.approve({ commandId: cmd(), key: other.key, attachmentIds: ["nope"] }))).toMatchObject({ _tag: "Invalid", field: "attachmentIds" })
      expect((yield* tasks.byKey(other.key)).statusId).not.toBe(status["Done"]!.id)
    })))
})

describe("CommentService.upload", () => {
  const runWithFiles = <A, E>(effect: Effect.Effect<A, E, any>) =>
    asHuman(effect).pipe(Effect.provide(services({ ffmpeg: null })), Effect.scoped) as Effect.Effect<A, E>
  const agent = asAgent({ session: "session-builder", client: "Claude Code", pid: process.pid })

  it.effect("takes PNG, JPEG, GIF and WebP up to 20 MB, from the human, for a task that exists; keeps only the name's last part", () =>
    runWithFiles(Effect.gen(function* () {
      const comments = yield* CommentService.CommentService
      const { project } = yield* setupProject
      const { result: task } = yield* (yield* TaskService.TaskService).create({ commandId: cmd(), projectId: project.id, title: "T" })
      const bytes = new Uint8Array([1, 2, 3])
      expect(yield* Effect.flip(agent(comments.upload({ taskId: task.id, name: "a.png", bytes })))).toMatchObject({ _tag: "HumanOnly" })
      expect(yield* Effect.flip(comments.upload({ taskId: task.id, name: "page.html", bytes }))).toMatchObject({
        _tag: "Invalid",
        reason: "page.html isn't a PNG, JPEG, GIF or WebP image",
      })
      expect(yield* Effect.flip(comments.upload({ taskId: task.id, name: "big.png", bytes: new Uint8Array(Drafts.MAX_UPLOAD_BYTES + 1) })))
        .toMatchObject({ _tag: "Invalid", reason: "big.png is over 20 MB" })
      expect(yield* Effect.flip(comments.upload({ taskId: "nope", name: "a.png", bytes }))).toMatchObject({ _tag: "NotFound", entity: "task" })

      // A name that climbs out of the folder is just a name: the file lands under the task's assets.
      const climbing = yield* comments.upload({ taskId: task.id, name: "../../../escape.png", bytes })
      expect(climbing.name).toBe("escape.png")
      const store = yield* AssetStore.AssetStore
      const stored = yield* (yield* ReviewService.ReviewService).file(climbing.id, "original")
      expect(path.relative(store.dir, stored.path)).toBe(path.join(task.id, `${climbing.id}.png`))
    })))

  it.effect("drafts never sent are removed a week after the upload; sent ones stay", () =>
    runWithFiles(Effect.gen(function* () {
      const comments = yield* CommentService.CommentService
      const reviews = yield* ReviewService.ReviewService
      const { project } = yield* setupProject
      const { result: task } = yield* (yield* TaskService.TaskService).create({ commandId: cmd(), projectId: project.id, title: "T" })
      const sent = yield* comments.upload({ taskId: task.id, name: "sent.png", bytes: new Uint8Array([1]) })
      const left = yield* comments.upload({ taskId: task.id, name: "left.png", bytes: new Uint8Array([2]) })
      yield* comments.add({ commandId: cmd(), taskId: task.id, body: "Here", attachmentIds: [sent.id] })
      const leftPath = (yield* reviews.file(left.id, "original")).path

      yield* TestClock.adjust(Drafts.COMMENT_DRAFT_TTL_MS - 1000)
      expect(yield* comments.sweepDrafts).toBe(0)
      yield* TestClock.adjust(1001)
      expect(yield* comments.sweepDrafts).toBe(1)
      expect(fs.existsSync(leftPath)).toBe(false)
      expect(yield* Effect.flip(reviews.file(left.id, "original"))).toMatchObject({ _tag: "NotFound" })
      expect((yield* reviews.file(sent.id, "original")).bytes).toBe(1)
    })))

  it.effect("a stale draft a send takes is never swept: the sweep re-checks each draft as it removes it", () =>
    runWithFiles(Effect.gen(function* () {
      const comments = yield* CommentService.CommentService
      const reviews = yield* ReviewService.ReviewService
      const { project } = yield* setupProject
      const { result: task } = yield* (yield* TaskService.TaskService).create({ commandId: cmd(), projectId: project.id, title: "T" })
      // Taken by a send after it went stale, before any sweep ran: it stays with its comment.
      const late = yield* comments.upload({ taskId: task.id, name: "late.png", bytes: new Uint8Array([1]) })
      yield* TestClock.adjust(Drafts.COMMENT_DRAFT_TTL_MS + 1)
      const { result: comment } = yield* comments.add({ commandId: cmd(), taskId: task.id, body: "Late", attachmentIds: [late.id] })
      expect(yield* comments.sweepDrafts).toBe(0)
      expect((yield* reviews.file(late.id, "original")).bytes).toBe(1)
      expect((yield* comments.list(task.id))[0]!.attachments!.map((a) => a.id)).toEqual([comment.attachments![0]!.id])

      // A sweep and a send at the same moment: either the send wins and the draft stays, or the sweep wins
      // and the send is refused. Never a sent comment whose screenshot was removed.
      for (let i = 0; i < 5; i++) {
        const racing = yield* comments.upload({ taskId: task.id, name: `race-${i}.png`, bytes: new Uint8Array([2]) })
        yield* TestClock.adjust(Drafts.COMMENT_DRAFT_TTL_MS + 1)
        const [swept, sent] = yield* Effect.all(
          [comments.sweepDrafts, Effect.exit(comments.add({ commandId: cmd(), taskId: task.id, body: `Race ${i}`, attachmentIds: [racing.id] }))],
          { concurrency: "unbounded" },
        )
        const kept = yield* Effect.exit(reviews.file(racing.id, "original"))
        if (sent._tag === "Success") {
          expect(kept._tag).toBe("Success")
          expect(sent.value.result.attachments!.map((a) => a.id)).toEqual([racing.id])
        } else {
          expect(swept).toBeGreaterThanOrEqual(1)
          expect(kept._tag).toBe("Failure")
        }
      }
    })))

  it.effect("sending a draft the sweep removed says it expired and to paste it again", () =>
    runWithFiles(Effect.gen(function* () {
      const comments = yield* CommentService.CommentService
      const { project } = yield* setupProject
      const { result: task } = yield* (yield* TaskService.TaskService).create({ commandId: cmd(), projectId: project.id, title: "T" })
      const stale = yield* comments.upload({ taskId: task.id, name: "stale.png", bytes: new Uint8Array([1]) })
      yield* TestClock.adjust(Drafts.COMMENT_DRAFT_TTL_MS + 1)
      expect(yield* comments.sweepDrafts).toBe(1)
      expect(yield* Effect.flip(comments.add({ commandId: cmd(), taskId: task.id, body: "Here", attachmentIds: [stale.id] }))).toMatchObject({
        _tag: "Invalid",
        field: "attachmentIds",
        reason: "this screenshot expired; paste it again",
      })
    })))
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

  it.effect("stores one form, so ❤ and ❤️ are the same reaction", () =>
    run(Effect.gen(function* () {
      const { comments, comment } = yield* commented
      const { result } = yield* comments.react({ commandId: cmd(), commentId: comment.id, emoji: "❤", on: true })
      expect(result.reactions!.map((r) => r.emoji)).toEqual(["❤️"])
      expect((yield* comments.react({ commandId: cmd(), commentId: comment.id, emoji: "❤️", on: true })).seq).toBeNull()
      const off = yield* comments.react({ commandId: cmd(), commentId: comment.id, emoji: "❤️", on: false })
      expect(off.result.reactions).toEqual([])
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
