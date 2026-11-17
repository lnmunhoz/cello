// Merge after I approve (CEL-143). In a project with the setting on, Approve doesn't end the agent's work:
// the task stays in In Review as Approved · merging (stage `merging`), the claim stays, and the claim
// holder's session gets an `approved` inbox item telling it to merge. Once merged, the agent's
// `cello task done` (ReviewService.done) moves the task to Done and ends the claim. With the setting off,
// Approve is what it always was: Done, the claim ends, and nothing reaches the session.
import * as fs from "node:fs"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as AskService from "../ask/AskService.ts"
import * as CommentService from "../comment/CommentService.ts"
import * as EventStore from "../events/EventStore.ts"
import * as InboxService from "../inbox/InboxService.ts"
import * as ProjectService from "../project/ProjectService.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { writePng } from "../testing/media.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as ReviewService from "./ReviewService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  asHuman(effect).pipe(Effect.provide(services({ ffmpeg: null })), Effect.scoped) as Effect.Effect<A, E>

const agent = asAgent({ session: "session-merge", client: "Claude Code", pid: process.pid })
const other = asAgent({ session: "session-merge-other", client: "Claude Code", pid: process.pid })

/** CEL with the setting as given, and CEL-1 claimed by the agent and submitted (In Review). */
const submitted = (mergeAfterApproval: boolean) =>
  Effect.gen(function* () {
    const tasks = yield* TaskService.TaskService
    const reviews = yield* ReviewService.ReviewService
    const { status, project } = yield* setupProject
    yield* (yield* ProjectService.ProjectService).update({ commandId: cmd(), id: project.id, mergeAfterApproval })
    const { result: created } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Merge after approval", statusId: status["Todo"]!.id })
    const { result: claimed } = yield* agent(tasks.claim({ commandId: cmd(), key: created.key }))
    const png = writePng(yield* tempDataDir, "board.png")
    yield* agent(reviews.submit({ commandId: cmd(), key: created.key, summary: "Done", steps: ["Look"], files: [{ path: png }], links: [] }))
    return { tasks, reviews, status, project, key: created.key, taskId: created.id, sessionId: claimed.assigneeSessionId! }
  })

const typesOf = (commandId: string) =>
  Effect.gen(function* () {
    const workspaceId = (yield* (yield* SnapshotService.SnapshotService).get()).workspaces[0]!.id
    const all = yield* (yield* EventStore.EventStore).readAfter({ workspaceId, projectId: null }, 0)
    return all.filter((e) => e.commandId === commandId).map((e) => e.type)
  })

const inboxOf = (who: typeof agent) => who(Effect.flatMap(Effect.service(InboxService.InboxService), (inbox) => inbox.take({ unreadOnly: true })))

describe("Approve in a project that merges after approval", () => {
  it.effect("keeps the claim, leaves the task in In Review as Approved · merging, and tells the session to merge", () =>
    run(Effect.gen(function* () {
      const { reviews, status, key, taskId, sessionId } = yield* submitted(true)
      const commandId = cmd()
      const { result: approved } = yield* reviews.approve({ commandId, key, note: "Ship it" })

      expect(approved).toMatchObject({ statusId: status["In Review"]!.id, stage: "merging", assigneeSessionId: sessionId })
      expect(yield* typesOf(commandId)).toEqual(["review.decided", "task.stage_changed"])
      expect((yield* reviews.list(taskId))[0]).toMatchObject({ decision: "approved", decisionNote: "Ship it" })

      const inbox = yield* inboxOf(agent)
      expect(inbox.items).toEqual([expect.objectContaining({ kind: "approved", taskKey: key, note: "Ship it", author: "Lucas" })])
      expect(inbox.claimed).toEqual([key])
      // Delivered once.
      expect((yield* inboxOf(agent)).items).toEqual([])
    })))

  it.effect("approving again while it waits for the merge is refused, and tells no one twice", () =>
    run(Effect.gen(function* () {
      const { reviews, key } = yield* submitted(true)
      yield* reviews.approve({ commandId: cmd(), key })
      expect(yield* Effect.flip(reviews.approve({ commandId: cmd(), key }))).toMatchObject({
        _tag: "Invalid",
        field: "key",
        reason: `${key} is approved already and waits for its agent to merge it; send it back to stop that`,
      })
      expect((yield* inboxOf(agent)).items.map((i) => i.kind)).toEqual(["approved"])
    })))

  it.effect("screenshots pasted with the approval reach the session as a comment, then the approval", () =>
    run(Effect.gen(function* () {
      const { reviews, key, taskId } = yield* submitted(true)
      const comments = yield* CommentService.CommentService
      const shot = yield* comments.upload({ taskId, name: "shot.png", bytes: new Uint8Array(fs.readFileSync(writePng(yield* tempDataDir, "shot.png"))) })
      yield* reviews.approve({ commandId: cmd(), key, note: "Looks right", attachmentIds: [shot.id] })
      const items = (yield* inboxOf(agent)).items
      expect(items.map((i) => i.kind)).toEqual(["comment", "approved"])
      expect(items[1]).toMatchObject({ note: null })
    })))

  it.effect("on a task nobody holds, the claim goes back to the session that last held it, which is told to merge", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, status, key, sessionId } = yield* submitted(true)
      yield* agent(tasks.release({ commandId: cmd(), key }))
      const { result: approved } = yield* reviews.approve({ commandId: cmd(), key })
      expect(approved).toMatchObject({ statusId: status["In Review"]!.id, stage: "merging", assigneeSessionId: sessionId })
      expect((yield* inboxOf(agent)).items.map((i) => i.kind)).toEqual(["approved"])
    })))

  it.effect("approved while its agent's question waits in Needs input: back to In Review as Approved · merging, the ask withdrawn", () =>
    run(Effect.gen(function* () {
      const { reviews, status, key, sessionId } = yield* submitted(true)
      const asks = yield* AskService.AskService
      yield* agent(asks.create({
        commandId: cmd(), key, title: "Merge now?", intro: "", questions: [{ prompt: "Merge it now?", options: [{ label: "Yes" }, { label: "No" }] }],
        files: [], links: [],
      }))
      const { result } = yield* reviews.approve({ commandId: cmd(), key })
      expect(result).toMatchObject({ statusId: status["In Review"]!.id, stage: "merging", assigneeSessionId: sessionId })
      expect((yield* inboxOf(agent)).items.map((i) => i.kind)).toEqual(["withdrawn", "approved"])
    })))

  it.effect("a task the human holds goes to Done as before: nobody else is there to merge it", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, status, key } = yield* submitted(true)
      yield* tasks.claim({ commandId: cmd(), key })
      const { result } = yield* reviews.approve({ commandId: cmd(), key })
      expect(result).toMatchObject({ statusId: status["Done"]!.id, stage: null })
    })))

  it.effect("the agent may say where the merge is (a failed merge: fixing), but not clear the stage; Send back still works", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, status, key, sessionId } = yield* submitted(true)
      yield* reviews.approve({ commandId: cmd(), key })
      expect((yield* agent(tasks.setStage({ commandId: cmd(), key, stage: "fixing" }))).result.stage).toBe("fixing")
      expect(yield* Effect.flip(agent(tasks.setStage({ commandId: cmd(), key, stage: null })))).toMatchObject({
        _tag: "Invalid",
        field: "stage",
        reason: `${key} is approved and waits for its merge: it keeps a stage until \`cello task done ${key}\``,
      })
      expect(yield* Effect.flip(other(tasks.setStage({ commandId: cmd(), key, stage: "merged" })))).toMatchObject({ _tag: "Invalid", field: "key" })

      // Lucas sends it back from the card: back to In Progress, still the agent's, the stage gone.
      const { result: sent } = yield* reviews.sendBack({ commandId: cmd(), key, note: "The merge broke the build: fix it first" })
      expect(sent).toMatchObject({ statusId: status["In Progress"]!.id, stage: null, assigneeSessionId: sessionId })
    })))

  it.effect("only Approve sets Approved · merging: an agent can't put it on a task in In Progress", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, key } = yield* submitted(true)
      yield* reviews.sendBack({ commandId: cmd(), key, note: "Again" })
      expect(yield* Effect.flip(agent(tasks.setStage({ commandId: cmd(), key, stage: "merging" })))).toMatchObject({
        _tag: "Invalid",
        field: "stage",
        reason: "merging is set by the human's Approve in a project that merges after approval",
      })
    })))
})

describe("Approve in a project that merges before review (the setting off)", () => {
  it.effect("is unchanged: Done, the claim ends, and nothing reaches the session", () =>
    run(Effect.gen(function* () {
      const { reviews, status, key } = yield* submitted(false)
      const commandId = cmd()
      const { result } = yield* reviews.approve({ commandId, key })
      expect(result).toMatchObject({ statusId: status["Done"]!.id, assigneeSessionId: null, stage: null })
      expect(yield* typesOf(commandId)).toEqual(["review.decided", "task.moved", "task.claim_ended"])
      expect((yield* inboxOf(agent)).items).toEqual([])
    })))
})

describe("task done", () => {
  it.effect("the claim holder finishes an approved task: Done, its claim ends", () =>
    run(Effect.gen(function* () {
      const { reviews, status, key } = yield* submitted(true)
      yield* reviews.approve({ commandId: cmd(), key })
      const commandId = cmd()
      const { result } = yield* agent(reviews.done({ commandId, key }))
      expect(result).toMatchObject({ statusId: status["Done"]!.id, stage: null, assigneeSessionId: null, assigneeActorId: null })
      expect(yield* typesOf(commandId)).toEqual(["task.moved", "task.released"])
      // A retry gets the same answer, and nothing happens twice.
      expect((yield* agent(reviews.done({ commandId, key }))).result).toEqual(result)
      // Running it again (a new command) says it's done, not that it isn't approved.
      expect(yield* Effect.flip(agent(reviews.done({ commandId: cmd(), key })))).toMatchObject({
        _tag: "Invalid",
        field: "key",
        reason: `${key} is Done already: there's nothing left to finish`,
      })
    })))

  // Asking from In Review would carry the task through Needs input, which clears its stage: the approval
  // would be lost, and `cello task done` would refuse it after the answer.
  it.effect("an approved task waiting for its merge takes no ask: comment on the card instead", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, status, key } = yield* submitted(true)
      yield* reviews.approve({ commandId: cmd(), key })
      const asks = yield* AskService.AskService
      expect(yield* Effect.flip(agent(asks.create({
        commandId: cmd(), key, title: "Rebase first?", intro: "", questions: [{ prompt: "Rebase first?", options: [{ label: "Yes" }, { label: "No" }] }],
        files: [], links: [],
      })))).toMatchObject({
        _tag: "Invalid",
        field: "key",
        reason: `${key} is approved and waiting for your merge: comment on the card (\`cello task comment ${key} "…"\`), or set \`cello task stage ${key} fixing\` if the merge failed`,
      })
      expect(yield* tasks.byKey(key)).toMatchObject({ statusId: status["In Review"]!.id, stage: "merging" })
    })))

  it.effect("is refused for a task that isn't approved: in In Progress, or in In Review waiting on the human", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, key } = yield* submitted(true)
      const notApproved = {
        _tag: "Invalid",
        field: "key",
        reason: `${key} isn't approved: \`cello task done\` finishes a task the human approved in a project that merges after approval (Approved · merging). Hand work in with \`cello task submit ${key}\``,
      }
      expect(yield* Effect.flip(agent(reviews.done({ commandId: cmd(), key })))).toMatchObject(notApproved)
      yield* reviews.sendBack({ commandId: cmd(), key, note: "Again" })
      expect(yield* Effect.flip(agent(reviews.done({ commandId: cmd(), key })))).toMatchObject(notApproved)
      expect((yield* tasks.byKey(key)).stage).toBeNull()
    })))

  it.effect("is refused for anyone but the claim holder: another session, or the human", () =>
    run(Effect.gen(function* () {
      const { tasks, reviews, status, key } = yield* submitted(true)
      yield* reviews.approve({ commandId: cmd(), key })
      expect(yield* Effect.flip(other(reviews.done({ commandId: cmd(), key })))).toMatchObject({
        _tag: "Invalid",
        field: "key",
        reason: `${key} is claimed by another session: only the session holding its claim finishes it, once merged`,
      })
      expect(yield* Effect.flip(reviews.done({ commandId: cmd(), key }))).toMatchObject({
        _tag: "Invalid",
        field: "key",
        reason: `${key} is claimed by another session: only the session holding its claim finishes it, once merged`,
      })
      expect((yield* tasks.byKey(key)).statusId).toBe(status["In Review"]!.id)
    })))
})
