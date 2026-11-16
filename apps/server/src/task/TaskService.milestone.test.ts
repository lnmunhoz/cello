// A task's milestone (CEL-113): at most one, an open milestone of its own project, set at create or
// later, by the human or an agent. It's planning, not taking the work over: an agent's claim stays.
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as MilestoneService from "../milestone/MilestoneService.ts"
import * as ProjectService from "../project/ProjectService.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as TaskService from "./TaskService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

const agent = asAgent({ session: "session-milestone", client: "Claude Code", pid: process.pid })

const setup = Effect.gen(function* () {
  const tasks = yield* TaskService.TaskService
  const milestones = yield* MilestoneService.MilestoneService
  const { project, workspace, status } = yield* setupProject
  const make = (name: string) => milestones.create({ commandId: cmd(), projectId: project.id, name }).pipe(Effect.map((w) => w.result))
  return { tasks, milestones, project, workspace, status, m2: yield* make("M2"), m3: yield* make("M3") }
})

describe("TaskService.setMilestone", () => {
  it.effect("puts a task in one milestone, moves it to another, takes it out; one event each, with before and after", () =>
    run(Effect.gen(function* () {
      const { tasks, project, m2, m3 } = yield* setup
      const { result: task } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Milestones" })
      expect(task.milestoneId).toBeNull()

      const { result: inM2 } = yield* tasks.setMilestone({ commandId: cmd(), id: task.id, milestoneId: m2.id })
      expect(inM2).toMatchObject({ milestoneId: m2.id, version: task.version + 1 })
      const { result: inM3 } = yield* tasks.setMilestone({ commandId: cmd(), id: task.id, milestoneId: m3.id })
      expect(inM3.milestoneId).toBe(m3.id)
      // The same milestone again: nothing changes.
      expect((yield* tasks.setMilestone({ commandId: cmd(), id: task.id, milestoneId: m3.id })).seq).toBeNull()
      const { result: none } = yield* tasks.setMilestone({ commandId: cmd(), id: task.id, milestoneId: null })
      expect(none.milestoneId).toBeNull()

      const changes = (yield* tasks.history(task.id)).filter((e) => e.type === "task.milestone_changed")
      expect(changes.map((e) => e.type === "task.milestone_changed" && [e.before, e.after, e.version])).toEqual([
        [null, m2.id, 2],
        [m2.id, m3.id, 3],
        [m3.id, null, 4],
      ])
      const snapshot = yield* (yield* SnapshotService.SnapshotService).get()
      expect(snapshot.tasks.find((t) => t.id === task.id)!.milestoneId).toBeNull()
    })))

  it.effect("refuses a closed milestone, another project's, or one that doesn't exist; a task already in a closed one stays", () =>
    run(Effect.gen(function* () {
      const { tasks, milestones, project, workspace, m2, m3 } = yield* setup
      const { result: task } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Milestones", milestoneId: m3.id })
      yield* milestones.close({ commandId: cmd(), id: m3.id })
      yield* milestones.close({ commandId: cmd(), id: m2.id })

      expect(yield* Effect.flip(tasks.setMilestone({ commandId: cmd(), id: task.id, milestoneId: m2.id }))).toMatchObject({
        _tag: "Invalid",
        field: "milestone",
        reason: "M2 is closed: put tasks in an open milestone, or reopen M2 first",
      })
      expect((yield* tasks.byKey(task.key)).milestoneId).toBe(m3.id)

      const { result: other } = yield* (yield* ProjectService.ProjectService).create({ commandId: cmd(), workspaceId: workspace.id, name: "Thai", key: "THAI" })
      const { result: theirs } = yield* milestones.create({ commandId: cmd(), projectId: other.id, name: "M4" })
      expect(yield* Effect.flip(tasks.setMilestone({ commandId: cmd(), id: task.id, milestoneId: theirs.id }))).toMatchObject({
        _tag: "Invalid",
        field: "milestone",
        reason: `"M4" is a milestone of THAI, not CEL: each project has its own milestones`,
      })
      expect(yield* Effect.flip(tasks.setMilestone({ commandId: cmd(), id: task.id, milestoneId: "nope" }))).toMatchObject({ _tag: "NotFound", entity: "milestone" })
      expect(yield* Effect.flip(tasks.create({ commandId: cmd(), projectId: project.id, title: "Late", milestoneId: m2.id }))).toMatchObject({ _tag: "Invalid", field: "milestone" })
    })))

  it.effect("create takes a milestone; an agent may assign one, and the human assigning keeps the agent's claim", () =>
    run(Effect.gen(function* () {
      const { tasks, project, m2, m3 } = yield* setup
      const { result: task, seq } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Milestones", milestoneId: m2.id })
      expect(task.milestoneId).toBe(m2.id)
      expect(seq).not.toBeNull()
      const history = yield* tasks.history(task.id)
      expect(history.map((e) => e.type)).toEqual(["task.created"])

      const { result: claimed } = yield* agent(tasks.claim({ commandId: cmd(), key: task.key }))
      const { result: moved } = yield* agent(tasks.setMilestone({ commandId: cmd(), id: task.id, milestoneId: m3.id }))
      expect(moved.milestoneId).toBe(m3.id)
      expect(moved.updatedBySessionId).toBe(claimed.assigneeSessionId)

      const { result: byHuman } = yield* tasks.setMilestone({ commandId: cmd(), id: task.id, milestoneId: null })
      expect(byHuman.assigneeSessionId).toBe(claimed.assigneeSessionId)
      expect((yield* tasks.history(task.id)).map((e) => e.type)).not.toContain("task.claim_ended")
    })))
})
