// The CLI's read models: whoami, context, task list and task detail.
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as CommentService from "../comment/CommentService.ts"
import * as LabelService from "../label/LabelService.ts"
import * as ProjectService from "../project/ProjectService.ts"
import * as Seed from "../persistence/Seed.ts"
import * as ReviewService from "../review/ReviewService.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd } from "../testing/fixtures.ts"
import { writePng } from "../testing/media.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import { ContextService } from "./ContextService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

const REPO = "/Users/lnmunhoz/projects/cello"
const agent = asAgent({ session: "2fd0505c", client: "Claude Code", pid: process.pid, cwd: REPO })
const rival = asAgent({ session: "rival", client: "Claude Code", pid: process.pid })

/** Project CEL linked to REPO, a "cli" label, and tasks CEL-1 (Todo), CEL-2 (Done), CEL-3 (Todo, labelled). */
const setup = Effect.gen(function* () {
  const snapshot = yield* (yield* SnapshotService.SnapshotService).get()
  const workspaceId = snapshot.workspaces[0]!.id
  const status = Object.fromEntries(snapshot.statuses.map((s) => [s.name, s]))
  const { result: project } = yield* (yield* ProjectService.ProjectService).create({
    commandId: cmd(), workspaceId, name: "Cello", key: "CEL", repoPath: REPO,
  })
  const { result: label } = yield* (yield* LabelService.LabelService).create({ commandId: cmd(), workspaceId, name: "cli", color: "#26B5CE" })
  const tasks = yield* TaskService.TaskService
  const make = (title: string, statusId: string, labelIds: string[] = []) =>
    tasks.create({ commandId: cmd(), projectId: project.id, title, statusId, labelIds }).pipe(Effect.map((w) => w.result))
  const one = yield* make("One", status["Todo"]!.id)
  const two = yield* make("Two", status["Done"]!.id)
  const three = yield* make("Three", status["Todo"]!.id, [label.id])
  return { project, status, label, tasks, one, two, three, context: yield* ContextService }
})

describe("ContextService.whoami", () => {
  it.effect("names the human, or the agent and its session, and the project when one resolves", () =>
    run(Effect.gen(function* () {
      const { context, project } = yield* setup
      const human = yield* Seed.HumanActor
      const me = yield* context.whoami({ repoPath: REPO })
      expect(me).toMatchObject({ actor: { id: human.id, kind: "human" }, session: null, project: { id: project.id } })

      const them = yield* agent(context.whoami({ repoPath: "/elsewhere" }))
      expect(them).toMatchObject({
        actor: { kind: "agent", name: "Claude Code" },
        session: { externalId: "2fd0505c", clientName: "Claude Code", cwd: REPO, pid: process.pid },
        project: null,
      })
    })))
})

describe("ContextService.context", () => {
  it.effect("shows the project, its statuses and labels, this session's claims and recent activity", () =>
    run(Effect.gen(function* () {
      const { context, project, label, tasks, one, three } = yield* setup
      yield* agent(tasks.claim({ commandId: cmd(), key: one.key }))
      yield* rival(tasks.claim({ commandId: cmd(), key: three.key }))
      yield* agent((yield* CommentService.CommentService).add({ commandId: cmd(), taskId: one.id, body: "Started" }))

      const ctx = yield* agent(context.context({ repoPath: REPO }))
      expect(ctx.project.id).toBe(project.id)
      expect(ctx.statuses.map((s) => s.name)).toContain("In Review")
      expect(ctx.labels.map((l) => l.id)).toEqual([label.id])
      expect(ctx.session?.externalId).toBe("2fd0505c")
      expect(ctx.claimed.map((t) => t.key)).toEqual([one.key])
      expect(ctx.recent.slice(0, 3).map((a) => [a.event.type, a.taskKey])).toEqual([
        ["comment.added", one.key],
        ["task.claimed", three.key],
        ["task.claimed", one.key],
      ])
      expect(ctx.sessions.map((s) => s.externalId).sort()).toEqual(["2fd0505c", "rival"])
      expect(ctx.lostClaims).toEqual([])
    })))

  it.effect("lists claims this session lost: taken over, or ended by a human change", () =>
    run(Effect.gen(function* () {
      const { context, tasks, status, one, three } = yield* setup
      yield* agent(tasks.claim({ commandId: cmd(), key: one.key }))
      yield* tasks.claim({ commandId: cmd(), key: one.key }) // the human takes it
      yield* agent(tasks.claim({ commandId: cmd(), key: three.key }))
      yield* tasks.move({ commandId: cmd(), id: three.id, statusId: status["Todo"]!.id }) // the human moves it back
      const ctx = yield* agent(context.context({ key: "CEL" }))
      expect(ctx.claimed).toEqual([])
      expect(ctx.lostClaims.map((a) => [a.event.type, a.taskKey])).toEqual([
        ["task.claim_ended", three.key],
        ["task.claim_taken", one.key],
      ])
      // Project-level events (project and label creation) aren't activity on tasks.
      expect(ctx.recent.every((a) => a.taskKey !== null)).toBe(true)
    })))

  it.effect("a packet withdrawn by a move is activity on its task (CEL-71)", () =>
    run(Effect.gen(function* () {
      const { context, tasks, status, one } = yield* setup
      yield* agent(tasks.claim({ commandId: cmd(), key: one.key }))
      const files = yield* tempDataDir
      yield* agent((yield* ReviewService.ReviewService).submit({
        commandId: cmd(), key: one.key, summary: "Done", steps: ["Look"], files: [{ path: writePng(files) }], links: [],
      }))
      yield* agent(tasks.move({ commandId: cmd(), id: one.id, statusId: status["In Progress"]!.id }))
      const ctx = yield* agent(context.context({ key: "CEL" }))
      expect(ctx.recent.slice(0, 2).map((a) => [a.event.type, a.taskKey])).toEqual([
        ["task.moved", one.key],
        ["review.withdrawn", one.key],
      ])
    }).pipe(Effect.scoped)))

  it.effect("fails with NotFound for a folder no project is linked to", () =>
    run(Effect.gen(function* () {
      const { context } = yield* setup
      expect(yield* Effect.flip(context.context({ repoPath: "/elsewhere" }))).toMatchObject({ _tag: "NotFound", entity: "project" })
    })))
})

describe("ContextService.taskList", () => {
  it.effect("lists open tasks by default; filters by status or label name, or to this session's claims", () =>
    run(Effect.gen(function* () {
      const { context, tasks, one, two, three } = yield* setup
      const keys = (list: { tasks: ReadonlyArray<{ key: string }> }) => list.tasks.map((t) => t.key)
      expect(keys(yield* context.taskList({ project: { key: "CEL" } }))).toEqual([one.key, three.key])
      expect(keys(yield* context.taskList({ project: { key: "CEL" }, status: "done" }))).toEqual([two.key])
      expect(keys(yield* context.taskList({ project: { key: "CEL" }, label: "CLI" }))).toEqual([three.key])
      yield* agent(tasks.claim({ commandId: cmd(), key: three.key }))
      expect(keys(yield* agent(context.taskList({ project: { repoPath: REPO }, mine: true })))).toEqual([three.key])
      yield* tasks.archive({ commandId: cmd(), id: one.id })
      expect(keys(yield* context.taskList({ project: { key: "CEL" } }))).toEqual([three.key])
    })))

  it.effect("an unknown status or label is Invalid and lists the real ones", () =>
    run(Effect.gen(function* () {
      const { context } = yield* setup
      expect(yield* Effect.flip(context.taskList({ project: { key: "CEL" }, status: "Doing" }))).toMatchObject({
        _tag: "Invalid",
        field: "status",
        reason: "no status named \"Doing\". Statuses: Backlog, Todo, In Progress, Needs input, In Review, Done, Canceled",
      })
      expect(yield* Effect.flip(context.taskList({ project: { key: "CEL" }, label: "nope" }))).toMatchObject({
        _tag: "Invalid",
        field: "label",
        reason: "no label named \"nope\". Labels: cli",
      })
    })))
})

describe("ContextService.taskDetail", () => {
  it.effect("returns the task with its comments, history and the names to print them", () =>
    run(Effect.gen(function* () {
      const { context, tasks, one, project } = yield* setup
      yield* agent(tasks.claim({ commandId: cmd(), key: one.key }))
      yield* agent((yield* CommentService.CommentService).add({ commandId: cmd(), taskId: one.id, body: "On it" }))
      const detail = yield* context.taskDetail("cel-1")
      expect(detail.task.key).toBe(one.key)
      expect(detail.project.id).toBe(project.id)
      expect(detail.comments.map((c) => c.body)).toEqual(["On it"])
      expect(detail.history.map((e) => e.type)).toEqual(["task.created", "task.claimed"])
      expect(detail.actors.map((a) => a.name)).toEqual(expect.arrayContaining(["Lucas", "Claude Code"]))
      expect(detail.sessions.map((s) => s.externalId)).toEqual(["2fd0505c"])
      expect(yield* Effect.flip(context.taskDetail("CEL-99"))).toMatchObject({ _tag: "NotFound", entity: "task", id: "CEL-99" })
    })))
})

describe("ContextService.labelList", () => {
  it.effect("lists the workspace's labels, archived ones too, with how many live tasks carry each here and in other projects", () =>
    run(Effect.gen(function* () {
      const { context, project, status, label, tasks, one, two } = yield* setup
      const labels = yield* LabelService.LabelService
      const { result: ui } = yield* labels.create({ commandId: cmd(), workspaceId: project.workspaceId, name: "ui", color: "#3B82F6" })
      const { result: old } = yield* labels.create({ commandId: cmd(), workspaceId: project.workspaceId, name: "old", color: "#6B7280" })
      yield* tasks.setLabels({ commandId: cmd(), id: one.id, add: [label.id, ui.id], remove: [] })
      yield* tasks.setLabels({ commandId: cmd(), id: two.id, add: [ui.id], remove: [] })
      yield* labels.archive({ commandId: cmd(), id: old.id })
      // An archived task doesn't count; a task in another project of the workspace counts apart.
      yield* tasks.archive({ commandId: cmd(), id: two.id })
      const { result: thai } = yield* (yield* ProjectService.ProjectService).create({
        commandId: cmd(), workspaceId: project.workspaceId, name: "Thai", key: "THAI",
      })
      yield* tasks.create({ commandId: cmd(), projectId: thai.id, title: "Elsewhere", statusId: status["Todo"]!.id, labelIds: [ui.id] })

      const list = yield* context.labelList({ repoPath: REPO })
      expect(list.project.key).toBe("CEL")
      expect(list.labels.map((l) => [l.label.name, l.tasks, l.otherProjects, l.label.archivedAt === null])).toEqual([
        ["cli", 2, 0, true],
        ["old", 0, 0, false],
        ["ui", 1, 1, true],
      ])
      expect(yield* Effect.flip(context.labelList({ key: "NOPE" }))).toMatchObject({ _tag: "NotFound", entity: "project" })
    })))
})
