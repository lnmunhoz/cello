// Milestones in the CLI's read models (CEL-113): every view names the project's milestones; `context`
// lists the open ones with their progress; `task list` filters by one; `milestone list` and
// `milestone get` show each one's progress and its tasks.
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as MilestoneService from "../milestone/MilestoneService.ts"
import * as ProjectService from "../project/ProjectService.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd } from "../testing/fixtures.ts"
import { asHuman, services } from "../testing/TestLayers.ts"
import { ContextService } from "./ContextService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

/** CEL with M2 (closed), M3 and M4 (empty); M3 holds CEL-1 Done, CEL-2 In Review, CEL-3 Todo, CEL-4 Backlog, CEL-5 Canceled, CEL-6 archived; CEL-7 has none. */
const setup = Effect.gen(function* () {
  const snapshot = yield* (yield* SnapshotService.SnapshotService).get()
  const workspaceId = snapshot.workspaces[0]!.id
  const status = Object.fromEntries(snapshot.statuses.map((s) => [s.name, s]))
  const { result: project } = yield* (yield* ProjectService.ProjectService).create({ commandId: cmd(), workspaceId, name: "Cello", key: "CEL" })
  const milestones = yield* MilestoneService.MilestoneService
  const make = (name: string, goal?: string) =>
    milestones.create({ commandId: cmd(), projectId: project.id, name, ...(goal ? { goal } : {}) }).pipe(Effect.map((w) => w.result))
  const m2 = yield* make("M2")
  const m3 = yield* make("M3", "Watching agents")
  const m4 = yield* make("M4")
  const tasks = yield* TaskService.TaskService
  const task = (title: string, statusName: string, milestoneId: string | null) =>
    tasks.create({ commandId: cmd(), projectId: project.id, title, statusId: status[statusName]!.id, milestoneId }).pipe(Effect.map((w) => w.result))
  yield* task("Done one", "Done", m3.id)
  yield* task("In review", "In Review", m3.id)
  yield* task("To do", "Todo", m3.id)
  yield* task("Someday", "Backlog", m3.id)
  yield* task("Dropped", "Canceled", m3.id)
  const archived = yield* task("Archived", "Done", m3.id)
  yield* tasks.archive({ commandId: cmd(), id: archived.id })
  yield* task("Loose", "Todo", null)
  yield* milestones.close({ commandId: cmd(), id: m2.id })
  return { project, m2, m3, m4, context: yield* ContextService }
})

describe("milestones in the CLI's read models", () => {
  it.effect("context names the project's milestones and lists the open ones with their progress", () =>
    run(Effect.gen(function* () {
      const { project, context } = yield* setup
      const ctx = yield* context.context({ key: project.key })
      expect(ctx.milestones.map((m) => `${m.name} ${m.state}`)).toEqual(["M2 closed", "M3 open", "M4 open"])
      expect(ctx.openMilestones!.map((s) => [s.milestone.name, s.progress])).toEqual([
        ["M3", { total: 4, done: 1, inReview: 1, inProgress: 0, todo: 1, backlog: 1, canceled: 1, percent: 25 }],
        ["M4", { total: 0, done: 0, inReview: 0, inProgress: 0, todo: 0, backlog: 0, canceled: 0, percent: 0 }],
      ])
    })))

  it.effect("task list filters by milestone name (any case), or none; an unknown name is refused with the names", () =>
    run(Effect.gen(function* () {
      const { project, context } = yield* setup
      const inM3 = yield* context.taskList({ project: { key: project.key }, milestone: "m3" })
      // Open tasks by default, as without the filter.
      expect(inM3.tasks.map((t) => t.title)).toEqual(["To do", "In review"])
      const backlog = yield* context.taskList({ project: { key: project.key }, milestone: "M3", status: "Backlog" })
      expect(backlog.tasks.map((t) => t.title)).toEqual(["Someday"])
      const loose = yield* context.taskList({ project: { key: project.key }, milestone: "none" })
      expect(loose.tasks.map((t) => t.title)).toEqual(["Loose"])
      expect(yield* Effect.flip(context.taskList({ project: { key: project.key }, milestone: "M9" }))).toMatchObject({
        _tag: "Invalid",
        field: "milestone",
        reason: `No milestone named "M9" in CEL (did you mean M2, M3 or M4?). Milestones: M2, M3, M4 (or none). Nothing was changed; \`cello milestone create M9\` makes it`,
      })
    })))

  it.effect("milestone list: every milestone in order with its progress; milestone get: one by name with its tasks", () =>
    run(Effect.gen(function* () {
      const { project, context, m3 } = yield* setup
      const list = yield* context.milestoneList({ key: project.key })
      expect(list.milestones.map((s) => `${s.milestone.name} ${s.progress.done}/${s.progress.total}`)).toEqual(["M2 0/0", "M3 1/4", "M4 0/0"])

      const detail = yield* context.milestoneDetail({ key: project.key }, "m3")
      expect(detail.milestone).toEqual(m3)
      expect(detail.progress.percent).toBe(25)
      // Every status but archived tasks, in board order.
      expect(detail.tasks.map((t) => t.title)).toEqual(["Someday", "To do", "In review", "Done one", "Dropped"])
      expect(yield* Effect.flip(context.milestoneDetail({ key: project.key }, "M9"))).toMatchObject({ _tag: "Invalid", field: "milestone" })
    })))
})
