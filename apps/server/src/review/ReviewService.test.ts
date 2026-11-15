// Review packets: submit copies the evidence and moves the task to In Review in one command; only the
// human approves or sends back; an agent can't move a task to In Review without a packet.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as SqlClient from "effect/sql/SqlClient"
import * as CommentService from "../comment/CommentService.ts"
import * as EventStore from "../events/EventStore.ts"
import * as Seed from "../persistence/Seed.ts"
import { isAlive } from "../process/isAlive.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { writeHungFfmpeg, writeMp4, writePng, writeSparse, writeText } from "../testing/media.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as AssetStore from "./AssetStore.ts"
import { MAX_ATTACHMENT_BYTES } from "./evidence.ts"
import * as ReviewService from "./ReviewService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>, options: { ffmpeg?: string | null } = { ffmpeg: null }) =>
  asHuman(effect).pipe(Effect.provide(services(options)), Effect.scoped) as Effect.Effect<A, E>

const agent = asAgent({ session: "session-review", client: "Claude Code", pid: process.pid })
const other = asAgent({ session: "session-other", client: "Claude Code", pid: process.pid })

/** A project with one task the agent has claimed (In Progress), plus a folder of evidence files. */
const setup = Effect.gen(function* () {
  const tasks = yield* TaskService.TaskService
  const reviews = yield* ReviewService.ReviewService
  const { status, project, workspace } = yield* setupProject
  const { result: created } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Review packets", statusId: status["Todo"]!.id })
  const { result: task } = yield* agent(tasks.claim({ commandId: cmd(), key: created.key }))
  const files = yield* tempDataDir
  return { tasks, reviews, status, project, workspace, task, files }
})

const packet = (key: string, files: ReadonlyArray<{ path: string; caption?: string }>, extra: Partial<ReviewService.SubmitReview> = {}) => ({
  commandId: cmd(),
  key,
  summary: "Adds **review packets**",
  steps: ["Open /review", "Play the video"],
  files,
  links: [],
  ...extra,
})

const eventsOf = (commandId: string) =>
  Effect.gen(function* () {
    const store = yield* EventStore.EventStore
    const all = yield* store.readAfter({ workspaceId: (yield* (yield* SnapshotService.SnapshotService).get()).workspaces[0]!.id, projectId: null }, 0)
    return all.filter((e) => e.commandId === commandId)
  })

describe("ReviewService.submit", () => {
  it.effect("copies the files into the data folder, records the packet and moves the task to In Review in one command", () =>
    run(Effect.gen(function* () {
      const { reviews, status, task, files } = yield* setup
      const assets = yield* AssetStore.AssetStore
      const png = writePng(files, "board.png")
      const log = writeText(files, "vitest.log", "Test Files  45 passed (45)")
      const input = packet(task.key, [{ path: png, caption: "The board" }, { path: log }], {
        links: [{ url: "https://github.com/lnmunhoz/cello/pull/10", caption: "The PR" }],
      })
      const { result, seq } = yield* agent(reviews.submit(input))

      expect(result.task.statusId).toBe(status["In Review"]!.id)
      expect(result.review).toMatchObject({
        taskId: task.id,
        summary: "Adds **review packets**",
        steps: ["Open /review", "Play the video"],
        decision: null,
        decidedAt: null,
        sessionId: task.assigneeSessionId,
        author: { name: "Claude Code", session: "session-review" },
      })
      const [image, text, link] = result.review.attachments
      expect(image).toMatchObject({ kind: "image", name: "board.png", caption: "The board", mime: "image/png", bytes: fs.statSync(png).size, hasPoster: false })
      expect(text).toMatchObject({ kind: "file", name: "vitest.log", caption: "", mime: "text/plain; charset=utf-8" })
      expect(link).toMatchObject({ kind: "link", name: "https://github.com/lnmunhoz/cello/pull/10", url: "https://github.com/lnmunhoz/cello/pull/10", caption: "The PR", mime: null })

      // The copies live under <assets>/<taskId>/, and the originals stay where they were.
      const stored = yield* reviews.file(image!.id, "original")
      expect(path.dirname(stored.path)).toBe(path.join(assets.dir, task.id))
      expect(fs.readFileSync(stored.path)).toEqual(fs.readFileSync(png))
      expect(stored).toMatchObject({ mime: "image/png", bytes: fs.statSync(png).size })
      expect(fs.existsSync(png)).toBe(true)

      const events = yield* eventsOf(input.commandId)
      expect(events.map((e) => e.type)).toEqual(["review.submitted", "task.moved"])
      expect(events.at(-1)!.seq).toBe(seq)
      expect(events[0]).toMatchObject({ review: { id: result.review.id, attachments: result.review.attachments } })

      // The agent keeps its claim while Lucas reviews.
      expect(result.task.assigneeSessionId).toBe(task.assigneeSessionId)
    })))

  it.effect("makes a poster frame for a video when ffmpeg is there", () =>
    run(Effect.gen(function* () {
      const { reviews, task, files } = yield* setup
      const video = writeMp4(files, "flow.mp4", { codec: "h264" })
      const { result } = yield* agent(reviews.submit(packet(task.key, [{ path: video, caption: "The flow" }])))
      const attachment = result.review.attachments[0]!
      expect(attachment).toMatchObject({ kind: "video", mime: "video/mp4", hasPoster: true, caption: "The flow" })
      const poster = yield* reviews.file(attachment.id, "poster")
      expect(poster.mime).toBe("image/jpeg")
      expect(fs.readFileSync(poster.path).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    }), { ffmpeg: Bun.which("ffmpeg") }))

  // A stopping server interrupts the submits in flight (CEL-17). The poster is made before the write,
  // so a hung ffmpeg can't hold the shutdown: it's killed and nothing is written.
  it.effect("a submit stuck making a poster stops when interrupted, kills ffmpeg and writes nothing", () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-ffmpeg-")))
    const ffmpeg = writeHungFfmpeg(dir)
    return run(Effect.gen(function* () {
      const { reviews, task, files } = yield* setup
      const video = writeText(files, "flow.mp4", "not really a video")
      const submit = yield* Effect.forkChild(agent(reviews.submit(packet(task.key, [{ path: video }]))))
      const pid = yield* Effect.promise(ffmpeg.started)
      yield* Fiber.interrupt(submit)
      expect(isAlive(pid)).toBe(false)
      expect(yield* reviews.list(task.id)).toEqual([])
    }).pipe(Effect.ensuring(Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })))), { ffmpeg: ffmpeg.bin })
  })

  it.effect("without ffmpeg the video is kept without a poster", () =>
    run(Effect.gen(function* () {
      const { reviews, task, files } = yield* setup
      const { result } = yield* agent(reviews.submit(packet(task.key, [{ path: writeText(files, "flow.mp4", "not really a video") }])))
      expect(result.review.attachments[0]).toMatchObject({ kind: "video", hasPoster: false })
      expect(yield* Effect.flip(reviews.file(result.review.attachments[0]!.id, "poster"))).toMatchObject({ _tag: "NotFound" })
    })))

  it.effect("refuses a missing file, and writes nothing", () =>
    run(Effect.gen(function* () {
      const { reviews, status, task, files } = yield* setup
      const assets = yield* AssetStore.AssetStore
      const png = writePng(files)
      const missing = path.join(files, "nope.mp4")
      const error = yield* Effect.flip(agent(reviews.submit(packet(task.key, [{ path: png }, { path: missing }]))))
      expect(error).toMatchObject({ _tag: "Invalid", field: "files", reason: `there's no file at ${missing}` })
      expect(yield* reviews.list(task.id)).toEqual([])
      expect(fs.existsSync(path.join(assets.dir, task.id))).toBe(false)
      expect((yield* (yield* TaskService.TaskService).byKey(task.key)).statusId).toBe(status["In Progress"]!.id)
    })))

  it.effect("refuses a file over 50 MB", () =>
    run(Effect.gen(function* () {
      const { reviews, task, files } = yield* setup
      const big = writeSparse(files, "huge.mp4", MAX_ATTACHMENT_BYTES + 1)
      expect(yield* Effect.flip(agent(reviews.submit(packet(task.key, [{ path: big }]))))).toMatchObject({
        _tag: "Invalid",
        field: "files",
        reason: `huge.mp4 is 50.0 MB; the limit is 50 MB`,
      })
      const edge = writeSparse(files, "edge.mp4", MAX_ATTACHMENT_BYTES)
      expect((yield* agent(reviews.submit(packet(task.key, [{ path: edge }])))).result.review.attachments).toHaveLength(1)
    })))

  it.effect("refuses types it can't show, relative paths and folders", () =>
    run(Effect.gen(function* () {
      const { reviews, task, files } = yield* setup
      const html = writeText(files, "page.html", "<script>alert(1)</script>")
      expect(yield* Effect.flip(agent(reviews.submit(packet(task.key, [{ path: html }]))))).toMatchObject({
        _tag: "Invalid",
        field: "files",
        reason: expect.stringContaining("page.html isn't an image, a video or a text file"),
      })
      expect(yield* Effect.flip(agent(reviews.submit(packet(task.key, [{ path: "shots/board.png" }]))))).toMatchObject({
        _tag: "Invalid",
        reason: "shots/board.png isn't an absolute path",
      })
      fs.mkdirSync(path.join(files, "folder.png"))
      expect(yield* Effect.flip(agent(reviews.submit(packet(task.key, [{ path: path.join(files, "folder.png") }]))))).toMatchObject({
        _tag: "Invalid",
        reason: `there's no file at ${path.join(files, "folder.png")}`,
      })
    })))

  it.effect("needs a summary, at least one step and some evidence; links must be http(s)", () =>
    run(Effect.gen(function* () {
      const { reviews, task, files } = yield* setup
      const png = writePng(files)
      const fail = (extra: Partial<ReviewService.SubmitReview>) => Effect.flip(agent(reviews.submit(packet(task.key, [{ path: png }], extra))))
      expect(yield* fail({ summary: "  " })).toMatchObject({ _tag: "Invalid", field: "summary" })
      expect(yield* fail({ steps: [" "] })).toMatchObject({ _tag: "Invalid", field: "steps", reason: "add at least one step that says how to check the work" })
      expect(yield* fail({ files: [] })).toMatchObject({ _tag: "Invalid", field: "files", reason: "attach evidence: a video, a screenshot, a test log or a link" })
      expect(yield* fail({ links: [{ url: "javascript:alert(1)" }] })).toMatchObject({ _tag: "Invalid", field: "links" })
      expect(yield* Effect.flip(agent(reviews.submit(packet("CEL-99", [{ path: png }]))))).toMatchObject({ _tag: "NotFound", entity: "task" })
    })))

  it.effect("a retry with the same command id returns the first result and copies nothing again", () =>
    run(Effect.gen(function* () {
      const { reviews, task, files } = yield* setup
      const assets = yield* AssetStore.AssetStore
      const input = packet(task.key, [{ path: writePng(files) }])
      const first = yield* agent(reviews.submit(input))
      const again = yield* agent(reviews.submit(input))
      expect(again).toEqual(first)
      expect(fs.readdirSync(path.join(assets.dir, task.id))).toHaveLength(1)
    })))

  it.effect("a new packet supersedes the open one: a task has one open review", () =>
    run(Effect.gen(function* () {
      const { reviews, task, files } = yield* setup
      const { result: first } = yield* agent(reviews.submit(packet(task.key, [{ path: writePng(files) }])))
      const { result: second } = yield* agent(reviews.submit(packet(task.key, [{ path: writePng(files, "v2.png") }], { summary: "Second try" })))
      const list = yield* reviews.list(task.id)
      expect(list.map((r) => [r.id, r.decision])).toEqual([[first.review.id, "superseded"], [second.review.id, null]])
      const snapshot = yield* (yield* SnapshotService.SnapshotService).get()
      expect(snapshot.reviews.map((r) => r.id)).toEqual([second.review.id])
    })))
})

describe("only the human decides", () => {
  it.effect("approve moves the task to the first completed status and closes the review", () =>
    run(Effect.gen(function* () {
      const { reviews, status, task, files } = yield* setup
      const { result: submitted } = yield* agent(reviews.submit(packet(task.key, [{ path: writePng(files) }])))

      expect(yield* Effect.flip(agent(reviews.approve({ commandId: cmd(), key: task.key })))).toMatchObject({
        _tag: "HumanOnly",
        action: "approve a review",
        human: (yield* Seed.HumanActor).name,
      })

      const commandId = cmd()
      const { result: approved } = yield* reviews.approve({ commandId, key: task.key, note: "Ship it" })
      expect(approved.statusId).toBe(status["Done"]!.id)
      expect((yield* eventsOf(commandId)).map((e) => e.type)).toEqual(["review.decided", "task.moved", "task.claim_ended"])
      const [review] = yield* reviews.list(task.id)
      expect(review).toMatchObject({ id: submitted.review.id, decision: "approved", decisionNote: "Ship it" })
      expect(review!.decidedAt).not.toBeNull()
      expect((yield* (yield* SnapshotService.SnapshotService).get()).reviews).toEqual([])
    })))

  it.effect("send back needs a note, moves the task to the first started status and adds the note as a comment", () =>
    run(Effect.gen(function* () {
      const { reviews, status, task, files } = yield* setup
      yield* agent(reviews.submit(packet(task.key, [{ path: writePng(files) }])))

      expect(yield* Effect.flip(other(reviews.sendBack({ commandId: cmd(), key: task.key, note: "No" })))).toMatchObject({ _tag: "HumanOnly", action: "send back a review" })
      expect(yield* Effect.flip(reviews.sendBack({ commandId: cmd(), key: task.key, note: " " }))).toMatchObject({ _tag: "Invalid", field: "note" })

      const commandId = cmd()
      const { result: sent } = yield* reviews.sendBack({ commandId, key: task.key, note: "The poster is black; grab a later frame." })
      expect(sent.statusId).toBe(status["In Progress"]!.id)
      // Sending back hands the work to the same agent: its claim stays.
      expect(sent.assigneeSessionId).toBe(task.assigneeSessionId)
      expect((yield* eventsOf(commandId)).map((e) => e.type)).toEqual(["review.decided", "task.moved", "comment.added"])
      expect((yield* reviews.list(task.id))[0]).toMatchObject({ decision: "sent_back", decisionNote: "The poster is black; grab a later frame." })
      const comments = yield* (yield* CommentService.CommentService).list(task.id)
      expect(comments.map((c) => [c.body, c.actorId])).toEqual([["The poster is black; grab a later frame.", (yield* Seed.HumanActor).id]])
    })))

  it.effect("approving a task with nothing to review is refused", () =>
    run(Effect.gen(function* () {
      const { reviews, task } = yield* setup
      expect(yield* Effect.flip(reviews.approve({ commandId: cmd(), key: task.key }))).toMatchObject({
        _tag: "Invalid",
        reason: `${task.key} has no open review and isn't in In Review`,
      })
    })))

  it.effect("the human can approve a task moved to In Review by hand, without a packet", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, status, task } = yield* setup
      yield* tasks.move({ commandId: cmd(), id: task.id, statusId: status["In Review"]!.id })
      const { result } = yield* reviews.approve({ commandId: cmd(), key: task.key })
      expect(result.statusId).toBe(status["Done"]!.id)
    })))
})

describe("no In Review without a review", () => {
  it.effect("an agent moving a task to In Review without an open packet is refused; with one it may", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, status, task, files } = yield* setup
      expect(yield* Effect.flip(agent(tasks.move({ commandId: cmd(), id: task.id, statusId: status["In Review"]!.id })))).toMatchObject({
        _tag: "ReviewRequired",
        key: task.key,
        status: "In Review",
      })
      const { result: submitted } = yield* agent(reviews.submit(packet(task.key, [{ path: writePng(files) }])))
      expect(submitted.task.statusId).toBe(status["In Review"]!.id)
      // Moving it out withdraws the packet (CEL-71), so coming back needs a new one.
      yield* agent(tasks.move({ commandId: cmd(), id: task.id, statusId: status["In Progress"]!.id }))
      expect(yield* Effect.flip(agent(tasks.move({ commandId: cmd(), id: task.id, statusId: status["In Review"]!.id })))).toMatchObject({
        _tag: "ReviewRequired",
      })
      yield* agent(reviews.submit(packet(task.key, [{ path: writePng(files, "v2.png") }])))
      expect((yield* tasks.byKey(task.key)).statusId).toBe(status["In Review"]!.id)
    })))

  it.effect("the human may move any task to In Review", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task } = yield* setup
      const { result } = yield* tasks.move({ commandId: cmd(), id: task.id, statusId: status["In Review"]!.id })
      expect(result.statusId).toBe(status["In Review"]!.id)
    })))
})

// CEL-71: an open packet belongs to a task in In Review (or waiting in Needs input, when the agent asked
// from there). Approve and Send back close it with a decision; any other way out withdraws it, in the
// move's own command, so the Review page never shows a packet for a task that isn't waiting on Lucas.
describe("moving a task out of In Review withdraws its packet", () => {
  it.effect("an agent's plain move: the packet closes as withdrawn, with an event saying where the task went", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, status, task, files } = yield* setup
      const { result: submitted } = yield* agent(reviews.submit(packet(task.key, [{ path: writePng(files) }])))

      const commandId = cmd()
      const { result: moved } = yield* agent(tasks.move({ commandId, id: task.id, statusId: status["In Progress"]!.id }))
      expect(moved.statusId).toBe(status["In Progress"]!.id)
      // The agent keeps its claim: it moved its own task.
      expect(moved.assigneeSessionId).toBe(task.assigneeSessionId)
      const events = yield* eventsOf(commandId)
      expect(events.map((e) => e.type)).toEqual(["review.withdrawn", "task.moved"])
      expect(events[0]).toMatchObject({
        id: submitted.review.id,
        taskId: task.id,
        to: status["In Progress"]!.id,
        actorId: task.assigneeActorId,
        sessionId: task.assigneeSessionId,
      })

      const [review] = yield* reviews.list(task.id)
      expect(review).toMatchObject({ id: submitted.review.id, decision: "withdrawn", decisionNote: null, decidedAt: events[0]!.ts })
      expect((yield* (yield* SnapshotService.SnapshotService).get()).reviews).toEqual([])
      expect((yield* (yield* EventStore.EventStore).history(submitted.review.id)).map((e) => e.type)).toEqual(["review.submitted", "review.withdrawn"])
    })))

  it.effect("Lucas dragging the card out of In Review withdraws it too, and ends the agent's claim as before", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, status, task, files } = yield* setup
      yield* agent(reviews.submit(packet(task.key, [{ path: writePng(files) }])))
      const commandId = cmd()
      yield* tasks.move({ commandId, id: task.id, statusId: status["Todo"]!.id })
      const events = yield* eventsOf(commandId)
      expect(events.map((e) => e.type)).toEqual(["review.withdrawn", "task.moved", "task.claim_ended"])
      expect(events[0]).toMatchObject({ to: status["Todo"]!.id, actorId: (yield* Seed.HumanActor).id, sessionId: null })
      expect((yield* reviews.list(task.id)).map((r) => r.decision)).toEqual(["withdrawn"])
    })))

  it.effect("reordering inside In Review, sending back and approving leave no withdrawal", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, status, task, files } = yield* setup
      yield* agent(reviews.submit(packet(task.key, [{ path: writePng(files) }])))
      const reorder = cmd()
      yield* tasks.move({ commandId: reorder, id: task.id, statusId: status["In Review"]!.id, after: null })
      expect((yield* reviews.list(task.id)).map((r) => r.decision)).toEqual([null])

      const sendBack = cmd()
      yield* reviews.sendBack({ commandId: sendBack, key: task.key, note: "Again" })
      yield* agent(reviews.submit(packet(task.key, [{ path: writePng(files, "v2.png") }])))
      const approve = cmd()
      yield* reviews.approve({ commandId: approve, key: task.key })
      const types = [...(yield* eventsOf(reorder)), ...(yield* eventsOf(sendBack)), ...(yield* eventsOf(approve))].map((e) => e.type)
      expect(types).not.toContain("review.withdrawn")
      expect((yield* reviews.list(task.id)).map((r) => r.decision)).toEqual(["sent_back", "approved"])
    })))

  it.effect("a packet left open on a task already out of In Review (before CEL-71) closes on the task's next move", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, status, task, files } = yield* setup
      const { result: submitted } = yield* agent(reviews.submit(packet(task.key, [{ path: writePng(files) }])))
      // How CEL-52's packet was left: the task moved on, the packet stayed open.
      yield* (yield* SqlClient.SqlClient)`UPDATE tasks SET status_id = ${status["In Progress"]!.id} WHERE id = ${task.id}`
      const commandId = cmd()
      yield* agent(tasks.move({ commandId, id: task.id, statusId: status["Todo"]!.id }))
      expect((yield* eventsOf(commandId))[0]).toMatchObject({ type: "review.withdrawn", id: submitted.review.id, to: status["Todo"]!.id })
    })))
})
