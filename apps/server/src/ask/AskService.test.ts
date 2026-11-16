// Needs input (CEL-47): an agent asks on the card and the task moves to Needs input; only the human
// answers (every question), which brings the task back to In Progress with its claim and drops the
// answers in the asking session's inbox. Asking again replaces the open ask; the agent can withdraw
// it; Lucas moving the card out withdraws it too; an agent can't move a task into Needs input by hand.
import * as fs from "node:fs"
import * as path from "node:path"
import type { AnswerInput } from "@cello/contract/rpcs"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as TestClock from "effect/testing/TestClock"
import * as EventStore from "../events/EventStore.ts"
import * as InboxService from "../inbox/InboxService.ts"
import * as Seed from "../persistence/Seed.ts"
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
        .toMatchObject({ reason: "question 1 asks for one pick, so recommend one option at most" })
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

  // CEL-71: the packet waits with the task in Needs input. Back to In Review (Lucas moving the card there)
  // keeps it open; back to work (his answers, the agent withdrawing, or a drag anywhere else) withdraws it:
  // the agent works again and hands in a new packet.
  it.effect("asked from In Review: the packet stays open back in In Review, and is withdrawn when the task goes back to work", () =>
    run(Effect.gen(function* () {
      const { tasks, asks, status, task, files } = yield* setup
      const reviews = yield* ReviewService.ReviewService
      const submit = () => agent(reviews.submit({ commandId: cmd(), key: task.key, summary: "Done", steps: ["Look"], files: [{ path: writePng(files) }], links: [] }))
      const decisions = () => Effect.map(reviews.list(task.id), (list) => list.map((r) => r.decision))

      // Lucas moves it back to In Review himself: the same packet waits for him there.
      yield* submit()
      yield* agent(asks.create(question(files)))
      yield* tasks.move({ commandId: cmd(), id: task.id, statusId: status["In Review"]!.id })
      expect(yield* decisions()).toEqual([null])

      // He answers: the task goes back to In Progress, and the packet with it is withdrawn.
      yield* agent(tasks.claim({ commandId: cmd(), key: task.key }))
      const { ask } = (yield* agent(asks.create(question(files)))).result
      const answer = answers(ask.id)
      yield* asks.answer(answer)
      expect((yield* eventsOf(answer.commandId)).map((e) => e.type)).toEqual(["ask.answered", "review.withdrawn", "task.moved"])
      expect(yield* decisions()).toEqual(["withdrawn"])

      // The agent withdraws its own questions: the same.
      yield* submit()
      yield* agent(asks.create(question(files)))
      yield* agent(asks.withdraw({ commandId: cmd(), key: task.key }))
      expect(yield* decisions()).toEqual(["withdrawn", "withdrawn"])
      expect((yield* (yield* SnapshotService.SnapshotService).get()).reviews).toEqual([])
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
      const withFirst = (first: AnswerInput) => ({ ...answers(ask.id), answers: [first, ...answers(ask.id).answers.slice(1)] })
      // A comment alone doesn't answer a question with options; None of these needs one.
      expect(yield* Effect.flip(asks.answer(withFirst({ questionId: "q1", optionIds: [], comment: "Hmm" }))))
        .toMatchObject({ reason: "answer every question: \"Which layout?\" has no answer" })
      expect(yield* Effect.flip(asks.answer(withFirst({ questionId: "q1", optionIds: [], none: true }))))
        .toMatchObject({ reason: "\"Which layout?\": say why none of these" })
      expect(yield* Effect.flip(asks.answer(withFirst({ questionId: "q1", optionIds: ["q1o1"], none: true, comment: "x" }))))
        .toMatchObject({ reason: "\"Which layout?\": none of these, or picks, not both" })
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
          { questionId: "q1", optionIds: ["q1o1"], none: false, comment: "Narrower preview, please", attachments: [] },
          { questionId: "q2", optionIds: ["q2o1", "q2o2"], none: false, comment: "", attachments: [] },
          { questionId: "q3", optionIds: [], none: false, comment: "Ship it after the e2e passes", attachments: [] },
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

  it.effect("takes several picks on any question, or None of these with a comment (Lucas, Nov 15)", () =>
    run(Effect.gen(function* () {
      const { asks, files } = yield* setup
      const { ask } = (yield* agent(asks.create(question(files)))).result
      const input = answers(ask.id)
      const { result } = yield* asks.answer({
        ...input,
        answers: [
          { questionId: "q1", optionIds: ["q1o1", "q1o2"], comment: "Both, behind a toggle" },
          { questionId: "q2", optionIds: [], none: true, comment: "Neither: a saved-search list" },
          input.answers[2]!,
        ],
      })
      expect(result.ask.answers!.questions.map((a) => [a.optionIds, a.none, a.comment])).toEqual([
        [["q1o1", "q1o2"], false, "Both, behind a toggle"],
        [[], true, "Neither: a saved-search list"],
        [[], false, "Ship it after the e2e passes"],
      ])
    })))

  it.effect("rounds: after Lucas answers, the agent asks a follow-up on the same card; the answered ask stays", () =>
    run(Effect.gen(function* () {
      const { asks, status, task, files } = yield* setup
      const first = (yield* agent(asks.create(question(files)))).result.ask
      yield* asks.answer(answers(first.id))
      const { result } = yield* agent(asks.create({ ...question(files), title: "Search layout, round 2" }))
      expect(result.task.statusId).toBe(status["Needs input"]!.id)
      expect((yield* asks.list(task.id)).map((a) => [a.title, a.state])).toEqual([
        ["Search layout", "answered"],
        ["Search layout, round 2", "open"],
      ])
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
      // The first session heard only that Lucas released its claim (CEL-46).
      expect((yield* agent(inbox.unread)).map((i) => i.kind)).toEqual(["claim_ended"])
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

describe("only the session holding the claim asks and withdraws", () => {
  it.effect("another session is refused, naming the holder; the holder's ask and inbox stay untouched", () =>
    run(Effect.gen(function* () {
      const { asks, task, files } = yield* setup
      const { ask } = (yield* agent(asks.create(question(files)))).result
      expect(yield* Effect.flip(other(asks.create(question(files))))).toMatchObject({
        _tag: "TaskClaimed",
        key: "CEL-1",
        holder: "Claude Code",
        sessionId: "session-ask",
      })
      expect(yield* Effect.flip(other(asks.withdraw({ commandId: cmd(), key: task.key })))).toMatchObject({ _tag: "TaskClaimed", sessionId: "session-ask" })
      expect((yield* asks.list(task.id)).map((a) => [a.id, a.state])).toEqual([[ask.id, "open"]])
    })))

  it.effect("the human is refused (Lucas answers, and withdraws by moving the card); an unclaimed task must be claimed first", () =>
    run(Effect.gen(function* () {
      const { asks, tasks, task, files } = yield* setup
      yield* agent(asks.create(question(files)))
      expect(yield* Effect.flip(asks.create(question(files)))).toMatchObject({
        _tag: "Invalid",
        reason: "questions come from the agent working on CEL-1; Lucas answers them, and withdraws one by moving the card",
      })
      expect(yield* Effect.flip(asks.withdraw({ commandId: cmd(), key: task.key }))).toMatchObject({ _tag: "Invalid", field: "key" })
      const { result: loose } = yield* tasks.create({ commandId: cmd(), projectId: task.projectId, title: "Nobody's" })
      expect(yield* Effect.flip(agent(asks.create({ ...question(files), key: loose.key })))).toMatchObject({
        _tag: "Invalid",
        reason: `claim ${loose.key} first (cello task claim ${loose.key}): only the session working on a task asks on it`,
      })
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
  it.effect("no one moves a task into Needs input by hand, agent or human: only an ask puts it there", () =>
    run(Effect.gen(function* () {
      const { tasks, status, task } = yield* setup
      const move = { commandId: cmd(), id: task.id, statusId: status["Needs input"]!.id }
      expect(yield* Effect.flip(agent(tasks.move(move)))).toMatchObject({ _tag: "AskRequired", key: "CEL-1", status: "Needs input" })
      expect(yield* Effect.flip(tasks.move({ ...move, commandId: cmd() }))).toMatchObject({ _tag: "AskRequired", key: "CEL-1" })
      expect((yield* tasks.byKey(task.key)).statusId).toBe(status["In Progress"]!.id)
    })))

  it.effect("Lucas moving the card out of Needs input withdraws the ask, ends the claim, and tells the session that asked where it went", () =>
    run(Effect.gen(function* () {
      const { asks, tasks, status, task, files } = yield* setup
      const inbox = yield* InboxService.InboxService
      const human = yield* Seed.HumanActor
      const { ask } = (yield* agent(asks.create(question(files)))).result
      const input = { commandId: cmd(), id: task.id, statusId: status["Todo"]!.id }
      const { result } = yield* tasks.move(input)
      expect(result.assigneeSessionId).toBeNull()
      // Withdrawn by the human, and kept in the task's list of asks.
      expect((yield* asks.list(task.id)).map((a) => [a.id, a.state, a.withdrawnBy])).toEqual([[ask.id, "withdrawn", human.id]])
      const events = yield* eventsOf(input.commandId)
      expect(events.map((e) => e.type)).toEqual(["ask.withdrawn", "task.moved", "task.claim_ended"])
      expect(events[0]).toMatchObject({ reason: "moved", actorId: human.id })
      expect(yield* agent(inbox.unread)).toMatchObject([{ kind: "withdrawn", taskKey: "CEL-1", status: "Todo", author: "Lucas", ask: { id: ask.id } }])
    })))

  it.effect("an agent moving its own card out tells no one", () =>
    run(Effect.gen(function* () {
      const { asks, tasks, status, task, files } = yield* setup
      yield* agent(asks.create(question(files)))
      yield* agent(tasks.move({ commandId: cmd(), id: task.id, statusId: status["Todo"]!.id }))
      expect((yield* asks.latest(task.key)).state).toBe("withdrawn")
      expect(yield* agent((yield* InboxService.InboxService).unread)).toEqual([])
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

  it.effect("while a wait is on, the hook's take leaves the answers to it: they're handed over once", () =>
    run(Effect.gen(function* () {
      const { asks, task, files } = yield* setup
      const inbox = yield* InboxService.InboxService
      const { ask } = (yield* agent(asks.create(question(files)))).result
      // Answered first, so the item is there the moment the wait starts: only the hold keeps take off it.
      yield* asks.answer(answers(ask.id))
      const held = yield* inbox.handOverAnswers(ask.id, agent(inbox.take({ unreadOnly: true })).pipe(Effect.map((taken) => ({ id: ask.id, taken }))))
        .pipe(agent)
      expect(held.taken.items).toEqual([])
      // The wait marked it read on its way out: nothing left for the hook either.
      expect((yield* agent(inbox.take({ unreadOnly: true }))).items).toEqual([])
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
