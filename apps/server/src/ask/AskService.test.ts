// Needs input (CEL-47): an agent asks on the card and the task moves to Needs input; only the human
// answers (every question), which brings the task back to In Progress with its claim and drops the
// answers in the asking session's inbox. Asking again replaces the open ask; the agent can withdraw
// it; Lucas moving the card out withdraws it too; an agent can't move a task into Needs input by hand.
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as TestClock from "effect/testing/TestClock"
import * as EventStore from "../events/EventStore.ts"
import * as InboxService from "../inbox/InboxService.ts"
import * as AssetStore from "../review/AssetStore.ts"
import * as ReviewService from "../review/ReviewService.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { writePng, writeText } from "../testing/media.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as AskService from "./AskService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  asHuman(effect).pipe(Effect.provide(services({ ffmpeg: null })), Effect.scoped) as Effect.Effect<A, E>

const agent = asAgent({ session: "session-ask", client: "Claude Code", pid: process.pid })
const other = asAgent({ session: "session-other", client: "Claude Code", pid: process.pid })

/** A project with one task the agent claimed (In Progress), and a folder of screenshots. */
const setup = Effect.gen(function* () {
  const tasks = yield* TaskService.TaskService
  const asks = yield* AskService.AskService
  const { status, project, workspace } = yield* setupProject
  const { result: created } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Search layout", statusId: status["Todo"]!.id })
  const { result: task } = yield* agent(tasks.claim({ commandId: cmd(), key: created.key }))
  const files = yield* tempDataDir
  return { tasks, asks, status, project, workspace, task, files }
})

const question = (files: string) => ({
  commandId: cmd(),
  key: "CEL-1",
  title: "Search layout",
  intro: "Two layouts, both built.",
  questions: [
    {
      prompt: "Which layout?",
      options: [
        { label: "Peek", description: "List + preview", image: writePng(files, "peek.png"), recommended: true, because: "Most results are long text" },
        { label: "Palette", image: writePng(files, "palette.png") },
      ],
    },
    { prompt: "Which extras?", kind: "any" as const, options: [{ label: "Filters" }, { label: "Recent searches" }] },
    { prompt: "Anything else?" },
  ],
  files: [{ path: writeText(files, "notes.txt", "Measured on 200 results"), caption: "Timings" }],
  links: [{ url: "http://127.0.0.1:4747/CEL/pages/cel-43-scope", caption: "The scope" }],
})

const eventsOf = (commandId: string) =>
  Effect.gen(function* () {
    const store = yield* EventStore.EventStore
    const all = yield* store.readAfter({ workspaceId: (yield* (yield* SnapshotService.SnapshotService).get()).workspaces[0]!.id, projectId: null }, 0)
    return all.filter((e) => e.commandId === commandId)
  })

/** Answers to the three questions above, picking `pick` for the first. */
const answers = (askId: string, pick = "q1o1") => ({
  commandId: cmd(),
  askId,
  answers: [
    { questionId: "q1", optionIds: [pick], comment: "Narrower preview, please" },
    { questionId: "q2", optionIds: ["q2o1", "q2o2"] },
    { questionId: "q3", optionIds: [], comment: "Ship it after the e2e passes" },
  ],
  note: "Thanks",
})

describe("AskService.create", () => {
  it.effect("records the questions with ids, stores the evidence (option images too), and moves the task to Needs input in one command", () =>
    run(Effect.gen(function* () {
      const { asks, status, task, files } = yield* setup
      const input = question(files)
      const { result, seq } = yield* agent(asks.create(input))

      expect(result.task.statusId).toBe(status["Needs input"]!.id)
      // The agent keeps its claim while Lucas decides.
      expect(result.task.assigneeSessionId).toBe(task.assigneeSessionId)
      const { ask } = result
      expect(ask).toMatchObject({
        taskId: task.id,
        title: "Search layout",
        intro: "Two layouts, both built.",
        state: "open",
        answers: null,
        author: { name: "Claude Code", session: "session-ask" },
      })
      expect(ask.questions.map((q) => [q.id, q.kind, q.options.map((o) => o.id)])).toEqual([
        ["q1", "one", ["q1o1", "q1o2"]],
        ["q2", "any", ["q2o1", "q2o2"]],
        ["q3", "text", []],
      ])
      expect(ask.questions[0]!.options[0]).toMatchObject({ label: "Peek", description: "List + preview", recommended: true, because: "Most results are long text" })
      // Evidence: the file, both option images and the link; each option points at its image.
      expect(ask.attachments.map((a) => [a.kind, a.name, a.caption])).toEqual([
        ["file", "notes.txt", "Timings"],
        ["image", "peek.png", ""],
        ["image", "palette.png", ""],
        ["link", "http://127.0.0.1:4747/CEL/pages/cel-43-scope", "The scope"],
      ])
      const byName = Object.fromEntries(ask.attachments.map((a) => [a.name, a]))
      expect(ask.questions[0]!.options.map((o) => o.imageId)).toEqual([byName["peek.png"]!.id, byName["palette.png"]!.id])
      expect(ask.attachments.every((a) => a.askId === ask.id)).toBe(true)
      const stored = yield* (yield* ReviewService.ReviewService).file(byName["peek.png"]!.id, "original")
      expect(fs.readFileSync(stored.path)).toEqual(fs.readFileSync(path.join(files, "peek.png")))

      const events = yield* eventsOf(input.commandId)
      expect(events.map((e) => e.type)).toEqual(["ask.created", "task.moved"])
      expect(events.at(-1)!.seq).toBe(seq)
      // The board sees it as an open ask.
      expect((yield* (yield* SnapshotService.SnapshotService).get()).asks.map((a) => a.id)).toEqual([ask.id])
    })))

  it.effect("an option image passed as a file too is stored once", () =>
    run(Effect.gen(function* () {
      const { asks, files } = yield* setup
      const png = writePng(files, "shot.png")
      const { result } = yield* agent(asks.create({
        ...question(files),
        questions: [{ prompt: "This one?", options: [{ label: "Yes", image: png }, { label: "No" }] }],
        files: [{ path: png, caption: "The board" }],
        links: [],
      }))
      expect(result.ask.attachments.map((a) => [a.name, a.caption])).toEqual([["shot.png", "The board"]])
      expect(result.ask.questions[0]!.options[0]!.imageId).toBe(result.ask.attachments[0]!.id)
    })))

  it.effect("refuses questions that can't be answered well, and writes nothing", () =>
    run(Effect.gen(function* () {
      const { asks, tasks, status, files } = yield* setup
      const fail = (questions: ReadonlyArray<unknown>, extra = {}) =>
        Effect.flip(agent(asks.create({ ...question(files), questions: questions as never, ...extra })))
      expect(yield* fail([])).toMatchObject({ _tag: "Invalid", field: "questions", reason: "ask at least one question" })
      expect(yield* fail([{ prompt: "Which?", options: [{ label: "A", recommended: true }] }])).toMatchObject({
        reason: "say why you recommend \"A\" (because)",
      })
      expect(yield* fail([{ prompt: "Which?", options: [{ label: "A", recommended: true, because: "x" }, { label: "B", recommended: true, because: "y" }] }]))
        .toMatchObject({ reason: "question 1 lets Lucas pick one, so recommend one option at most" })
      expect(yield* fail([{ prompt: "Why?", kind: "text", options: [{ label: "A" }] }])).toMatchObject({ reason: "question 1 is text only, so it can't have options" })
      expect(yield* fail([{ prompt: "Which?", kind: "any" }])).toMatchObject({ reason: "question 1 needs options to choose from (or kind \"text\")" })
      expect(yield* fail([{ prompt: "Which?", options: [{ label: "A", image: writeText(files, "a.txt", "no") }] }])).toMatchObject({
        reason: "a.txt isn't an image, so it can't show on an option",
      })
      expect(yield* fail([{ prompt: "Which?", options: [{ label: "A" }] }], { title: " " })).toMatchObject({ field: "title" })
      expect(yield* (yield* AskService.AskService).list((yield* tasks.byKey("CEL-1")).id)).toEqual([])
      expect((yield* tasks.byKey("CEL-1")).statusId).toBe(status["In Progress"]!.id)
    })))

  it.effect("asking again replaces the open ask: the first is superseded, kept in the task's list", () =>
    run(Effect.gen(function* () {
      const { asks, task, files } = yield* setup
      const first = (yield* agent(asks.create(question(files)))).result.ask
      const input = { ...question(files), title: "Search layout, again" }
      const second = (yield* agent(asks.create(input))).result.ask
      expect((yield* asks.list(task.id)).map((a) => [a.id, a.state])).toEqual([[first.id, "superseded"], [second.id, "open"]])
      expect((yield* eventsOf(input.commandId)).map((e) => e.type)).toEqual(["ask.withdrawn", "ask.created"])
      expect((yield* asks.latest(task.key)).id).toBe(second.id)
    })))

  it.effect("a task in In Review can be asked about: the packet stays open", () =>
    run(Effect.gen(function* () {
      const { asks, status, task, files } = yield* setup
      const reviews = yield* ReviewService.ReviewService
      yield* agent(reviews.submit({ commandId: cmd(), key: task.key, summary: "Done", steps: ["Look"], files: [{ path: writePng(files) }], links: [] }))
      const { result } = yield* agent(asks.create(question(files)))
      expect(result.task.statusId).toBe(status["Needs input"]!.id)
      expect((yield* reviews.list(task.id)).map((r) => r.decision)).toEqual([null])
    })))
})

describe("AskService.answer", () => {
  it.effect("only the human answers; every question needs an answer, with options from the ask", () =>
    run(Effect.gen(function* () {
      const { asks, files } = yield* setup
      const { ask } = (yield* agent(asks.create(question(files)))).result
      expect(yield* Effect.flip(agent(asks.answer(answers(ask.id))))).toMatchObject({ _tag: "HumanOnly", action: "answer an ask", human: "Lucas" })
      const partial = { ...answers(ask.id), answers: answers(ask.id).answers.slice(0, 2) }
      expect(yield* Effect.flip(asks.answer(partial))).toMatchObject({ _tag: "Invalid", reason: "answer every question: \"Anything else?\" has no answer" })
      expect(yield* Effect.flip(asks.answer(answers(ask.id, "q2o1")))).toMatchObject({ reason: "\"Which layout?\": no option q2o1" })
      const two = { ...answers(ask.id), answers: [{ questionId: "q1", optionIds: ["q1o1", "q1o2"] }, ...answers(ask.id).answers.slice(1)] }
      expect(yield* Effect.flip(asks.answer(two))).toMatchObject({ reason: "\"Which layout?\": one option only" })
      const stranger = { ...answers(ask.id), answers: [...answers(ask.id).answers, { questionId: "q9", optionIds: [] }] }
      expect(yield* Effect.flip(asks.answer(stranger))).toMatchObject({ reason: "this ask has no question q9" })
      expect((yield* asks.latest("CEL-1")).state).toBe("open")
    })))

  it.effect("saves the answers, brings the task back to In Progress with its claim, and drops them in the asking session's inbox", () =>
    run(Effect.gen(function* () {
      const { asks, status, task, files } = yield* setup
      const inbox = yield* InboxService.InboxService
      const { ask } = (yield* agent(asks.create(question(files)))).result
      const input = answers(ask.id)
      const { result } = yield* asks.answer(input)

      expect(result.task).toMatchObject({ statusId: status["In Progress"]!.id, assigneeSessionId: task.assigneeSessionId })
      expect(result.ask).toMatchObject({ state: "answered", answeredAt: expect.any(Number) })
      expect(result.ask.answers).toEqual({
        questions: [
          { questionId: "q1", optionIds: ["q1o1"], comment: "Narrower preview, please", attachments: [] },
          { questionId: "q2", optionIds: ["q2o1", "q2o2"], comment: "", attachments: [] },
          { questionId: "q3", optionIds: [], comment: "Ship it after the e2e passes", attachments: [] },
        ],
        note: "Thanks",
        noteAttachments: [],
      })
      expect((yield* eventsOf(input.commandId)).map((e) => e.type)).toEqual(["ask.answered", "task.moved"])
      expect((yield* (yield* SnapshotService.SnapshotService).get()).asks).toEqual([])

      const delivered = yield* agent(inbox.unread)
      expect(delivered).toMatchObject([{ kind: "answers", taskKey: "CEL-1", author: "Lucas", readAt: null, ask: { id: ask.id, state: "answered" } }])
      expect(yield* other(inbox.unread)).toEqual([])
      // Answered is final.
      expect(yield* Effect.flip(asks.answer(answers(ask.id)))).toMatchObject({ _tag: "Invalid", reason: "this ask is answered, so it can't be answered" })
    })))

  it.effect("when another session took over the claim, the answers go to it", () =>
    run(Effect.gen(function* () {
      const { asks, tasks, status, task, files } = yield* setup
      const inbox = yield* InboxService.InboxService
      const { ask } = (yield* agent(asks.create(question(files)))).result
      // Lucas releases the claim, then the other session claims the task: it stays in Needs input.
      yield* tasks.release({ commandId: cmd(), key: task.key })
      const { result: taken } = yield* other(tasks.claim({ commandId: cmd(), key: task.key }))
      expect(taken.statusId).toBe(status["Needs input"]!.id)
      yield* asks.answer(answers(ask.id))
      expect((yield* other(inbox.unread)).map((i) => i.kind)).toEqual(["answers"])
      expect(yield* agent(inbox.unread)).toEqual([])
    })))

  it.effect("screenshots pasted into the answers are uploaded as drafts, then linked to what they answer", () =>
    run(Effect.gen(function* () {
      const { asks, files } = yield* setup
      const { ask } = (yield* agent(asks.create(question(files)))).result
      const bytes = new Uint8Array(fs.readFileSync(writePng(files, "pasted.png")))
      const one = yield* asks.upload({ askId: ask.id, name: "image.png", bytes })
      const two = yield* asks.upload({ askId: ask.id, name: "drop.webp", bytes })
      const unused = yield* asks.upload({ askId: ask.id, name: "unused.png", bytes })
      expect(one).toMatchObject({ kind: "image", name: "image.png", mime: "image/png", askId: ask.id, sessionId: null, bytes: bytes.byteLength })
      // Drafts don't show as the ask's evidence.
      expect((yield* asks.latest("CEL-1")).attachments.map((a) => a.name)).not.toContain("image.png")

      const input = answers(ask.id)
      const { result } = yield* asks.answer({
        ...input,
        answers: [{ ...input.answers[0]!, attachmentIds: [one.id] }, ...input.answers.slice(1)],
        noteAttachmentIds: [two.id],
      })
      expect(result.ask.answers!.questions[0]!.attachments.map((a) => a.id)).toEqual([one.id])
      expect(result.ask.answers!.noteAttachments.map((a) => [a.id, a.mime])).toEqual([[two.id, "image/webp"]])
      expect(result.ask.attachments.map((a) => a.id)).not.toContain(unused.id)
      const stored = yield* (yield* ReviewService.ReviewService).file(one.id, "original")
      expect(new Uint8Array(fs.readFileSync(stored.path))).toEqual(bytes)
    })))

  it.effect("refuses a screenshot that isn't a draft of this ask, or is used twice", () =>
    run(Effect.gen(function* () {
      const { asks, files } = yield* setup
      const { ask } = (yield* agent(asks.create(question(files)))).result
      const shot = yield* asks.upload({ askId: ask.id, name: "a.png", bytes: new Uint8Array([1]) })
      const input = answers(ask.id)
      const twice = { ...input, answers: [{ ...input.answers[0]!, attachmentIds: [shot.id] }, ...input.answers.slice(1)], noteAttachmentIds: [shot.id] }
      expect(yield* Effect.flip(asks.answer(twice))).toMatchObject({ _tag: "Invalid", field: "attachmentIds" })
      const evidence = ask.attachments[0]!.id
      expect(yield* Effect.flip(asks.answer({ ...input, noteAttachmentIds: [evidence] }))).toMatchObject({ _tag: "Invalid", field: "attachmentIds" })
    })))
})

describe("AskService.upload", () => {
  it.effect("takes PNG, JPEG, GIF and WebP up to 20 MB, from the human, for an open ask", () =>
    run(Effect.gen(function* () {
      const { asks, files } = yield* setup
      const { ask } = (yield* agent(asks.create(question(files)))).result
      const bytes = new Uint8Array([1, 2, 3])
      expect(yield* Effect.flip(agent(asks.upload({ askId: ask.id, name: "a.png", bytes })))).toMatchObject({ _tag: "HumanOnly" })
      expect(yield* Effect.flip(asks.upload({ askId: ask.id, name: "page.html", bytes }))).toMatchObject({
        _tag: "Invalid",
        reason: "page.html isn't a PNG, JPEG, GIF or WebP image",
      })
      expect(yield* Effect.flip(asks.upload({ askId: ask.id, name: "big.png", bytes: new Uint8Array(AskService.MAX_UPLOAD_BYTES + 1) })))
        .toMatchObject({ _tag: "Invalid", reason: "big.png is over 20 MB" })
      expect(yield* Effect.flip(asks.upload({ askId: "nope", name: "a.png", bytes }))).toMatchObject({ _tag: "NotFound", entity: "ask" })
      yield* agent(asks.withdraw({ commandId: cmd(), key: "CEL-1" }))
      expect(yield* Effect.flip(asks.upload({ askId: ask.id, name: "a.png", bytes }))).toMatchObject({
        _tag: "Invalid",
        reason: "this ask is withdrawn, so it takes no more answers",
      })
    })))

  it.effect("drafts never sent are removed a day after their ask closed; sent ones and open asks' drafts stay", () =>
    run(Effect.gen(function* () {
      const { asks, files } = yield* setup
      const store = yield* AssetStore.AssetStore
      const reviews = yield* ReviewService.ReviewService
      const first = (yield* agent(asks.create(question(files)))).result.ask
      const sent = yield* asks.upload({ askId: first.id, name: "sent.png", bytes: new Uint8Array([1]) })
      const left = yield* asks.upload({ askId: first.id, name: "left.png", bytes: new Uint8Array([2]) })
      const input = answers(first.id)
      yield* asks.answer({ ...input, noteAttachmentIds: [sent.id] })
      // A newer ask, with a draft of its own, still open.
      const second = (yield* agent(asks.create(question(files)))).result.ask
      const drafting = yield* asks.upload({ askId: second.id, name: "drafting.png", bytes: new Uint8Array([3]) })
      const leftPath = (yield* reviews.file(left.id, "original")).path

      expect(yield* asks.sweepDrafts).toBe(0)
      yield* TestClock.adjust(AskService.DRAFT_TTL_MS + 1)
      expect(yield* asks.sweepDrafts).toBe(1)
      expect(fs.existsSync(leftPath)).toBe(false)
      expect(yield* Effect.flip(reviews.file(left.id, "original"))).toMatchObject({ _tag: "NotFound" })
      expect((yield* reviews.file(sent.id, "original")).path.startsWith(store.dir)).toBe(true)
      expect((yield* reviews.file(drafting.id, "original")).path.startsWith(store.dir)).toBe(true)
    })))
})

describe("AskService.withdraw", () => {
  it.effect("takes the open ask back and returns the task to In Progress, claim kept", () =>
    run(Effect.gen(function* () {
      const { asks, status, task, files } = yield* setup
      const { ask } = (yield* agent(asks.create(question(files)))).result
      const input = { commandId: cmd(), key: task.key }
      const { result } = yield* agent(asks.withdraw(input))
      expect(result.ask).toMatchObject({ id: ask.id, state: "withdrawn", withdrawnAt: expect.any(Number), withdrawnBy: task.assigneeActorId })
      expect(result.task).toMatchObject({ statusId: status["In Progress"]!.id, assigneeSessionId: task.assigneeSessionId })
      const events = yield* eventsOf(input.commandId)
      expect(events.map((e) => e.type)).toEqual(["ask.withdrawn", "task.moved"])
      expect(events[0]).toMatchObject({ reason: "agent" })
      expect(yield* Effect.flip(agent(asks.withdraw({ commandId: cmd(), key: task.key })))).toMatchObject({
        _tag: "Invalid",
        reason: "CEL-1 has no open ask to withdraw",
      })
    })))
})

describe("Needs input and moves", () => {
  it.effect("an agent can't move a task into Needs input by hand; the human can", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task } = yield* setup
      const move = { commandId: cmd(), id: task.id, statusId: status["Needs input"]!.id }
      expect(yield* Effect.flip(agent(tasks.move(move)))).toMatchObject({ _tag: "AskRequired", key: "CEL-1", status: "Needs input" })
      expect((yield* tasks.move({ ...move, commandId: cmd() })).result.statusId).toBe(status["Needs input"]!.id)
    })))

  it.effect("Lucas moving the card out of Needs input withdraws the ask, and ends the claim as any human move does", () =>
    run(Effect.gen(function* () {
      const { asks, tasks, status, task, files } = yield* setup
      const { ask } = (yield* agent(asks.create(question(files)))).result
      const input = { commandId: cmd(), id: task.id, statusId: status["Todo"]!.id }
      const { result } = yield* tasks.move(input)
      expect(result.assigneeSessionId).toBeNull()
      expect((yield* asks.latest(task.key))).toMatchObject({ id: ask.id, state: "withdrawn" })
      const events = yield* eventsOf(input.commandId)
      expect(events.map((e) => e.type)).toEqual(["ask.withdrawn", "task.moved", "task.claim_ended"])
      expect(events[0]).toMatchObject({ reason: "moved" })
    })))

  it.effect("reordering within Needs input keeps the ask", () =>
    run(Effect.gen(function* () {
      const { asks, tasks, status, task, files } = yield* setup
      yield* agent(asks.create(question(files)))
      yield* tasks.move({ commandId: cmd(), id: task.id, statusId: status["Needs input"]!.id })
      expect((yield* asks.latest(task.key)).state).toBe("open")
    })))
})

describe("AskService.wait", () => {
  it.effect("returns when Lucas answers, and marks the answers read so the hook doesn't deliver them again", () =>
    run(Effect.gen(function* () {
      const { asks, task, files } = yield* setup
      const inbox = yield* InboxService.InboxService
      const { ask } = (yield* agent(asks.create(question(files)))).result
      const waiting = yield* Effect.forkChild(agent(asks.wait(task.key)))
      yield* Effect.yieldNow
      yield* asks.answer(answers(ask.id))
      const answered = yield* Fiber.join(waiting)
      expect(answered).toMatchObject({ id: ask.id, state: "answered" })
      expect(yield* agent(inbox.unread)).toEqual([])
      // Already answered: at once.
      expect((yield* agent(asks.wait(task.key))).state).toBe("answered")
    })))

  it.effect("returns the withdrawn ask when it's withdrawn; NotFound when the task has never asked", () =>
    run(Effect.gen(function* () {
      const { asks, task, files } = yield* setup
      yield* agent(asks.create(question(files)))
      const waiting = yield* Effect.forkChild(agent(asks.wait(task.key)))
      yield* Effect.yieldNow
      yield* agent(asks.withdraw({ commandId: cmd(), key: task.key }))
      expect((yield* Fiber.join(waiting)).state).toBe("withdrawn")
      const tasks = yield* TaskService.TaskService
      const { result: fresh } = yield* tasks.create({ commandId: cmd(), projectId: task.projectId, title: "Quiet" })
      expect(yield* Effect.flip(asks.wait(fresh.key))).toMatchObject({ _tag: "NotFound", entity: "ask" })
    })))
})
