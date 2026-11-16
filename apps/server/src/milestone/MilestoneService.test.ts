// Milestones (CEL-113): a project's goals, in the order the human sets. Names are unique in the project;
// agents may create and edit them, but closing and reopening are the human's only, like deciding a review.
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as EventStore from "../events/EventStore.ts"
import * as ProjectService from "../project/ProjectService.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services, TEST_HUMAN } from "../testing/TestLayers.ts"
import * as MilestoneService from "./MilestoneService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

const agent = asAgent({ session: "session-milestones", client: "Claude Code", pid: process.pid })

describe("MilestoneService", () => {
  it.effect("create: a trimmed name, free in the project in any case; goal and date optional; each new one goes last", () =>
    run(Effect.gen(function* () {
      const milestones = yield* MilestoneService.MilestoneService
      const store = yield* EventStore.EventStore
      const { project, workspace } = yield* setupProject
      const { result: m2, seq } = yield* milestones.create({ commandId: cmd(), projectId: project.id, name: " M2 " })
      expect(m2).toMatchObject({ projectId: project.id, name: "M2", goal: "", targetDate: null, state: "open", closedAt: null })
      expect(seq).not.toBeNull()
      const [created] = yield* store.history(m2.id)
      expect(created).toMatchObject({ type: "milestone.created", milestone: m2, workspaceId: workspace.id, projectId: project.id })

      const { result: m3 } = yield* milestones.create({ commandId: cmd(), projectId: project.id, name: "M3", goal: "Watching agents", targetDate: "2026-12-01" })
      expect(m3).toMatchObject({ goal: "Watching agents", targetDate: "2026-12-01" })
      expect(m3.position > m2.position).toBe(true)

      expect(yield* Effect.flip(milestones.create({ commandId: cmd(), projectId: project.id, name: "m2" }))).toMatchObject({
        _tag: "Invalid",
        field: "name",
        reason: `there's already a milestone named "M2" in CEL`,
      })
      expect(yield* Effect.flip(milestones.create({ commandId: cmd(), projectId: project.id, name: "  " }))).toMatchObject({ _tag: "Invalid", field: "name" })
      expect(yield* Effect.flip(milestones.create({ commandId: cmd(), projectId: project.id, name: "M5", targetDate: "Dec 1" }))).toMatchObject({
        _tag: "Invalid",
        field: "targetDate",
      })
      expect(yield* Effect.flip(milestones.create({ commandId: cmd(), projectId: "nope", name: "M5" }))).toMatchObject({ _tag: "NotFound", entity: "project" })

      // Another project may use the same name.
      const { result: other } = yield* (yield* ProjectService.ProjectService).create({ commandId: cmd(), workspaceId: workspace.id, name: "Thai", key: "THAI" })
      const { result: theirs } = yield* milestones.create({ commandId: cmd(), projectId: other.id, name: "M2" })
      expect(theirs.projectId).toBe(other.id)

      // The board's snapshot carries every project's milestones, in order.
      const snapshot = yield* (yield* SnapshotService.SnapshotService).get()
      expect(snapshot.milestones!.map((m) => `${m.projectId === project.id ? "CEL" : "THAI"} ${m.name}`)).toEqual(["CEL M2", "CEL M3", "THAI M2"])
    })))

  it.effect("update: rename (still free), goal, target date (null clears it) and order among the project's milestones; one event with what changed", () =>
    run(Effect.gen(function* () {
      const milestones = yield* MilestoneService.MilestoneService
      const store = yield* EventStore.EventStore
      const { project } = yield* setupProject
      const make = (name: string) => milestones.create({ commandId: cmd(), projectId: project.id, name }).pipe(Effect.map((w) => w.result))
      const m2 = yield* make("M2")
      const m3 = yield* make("M3")
      const m4 = yield* make("M4")

      const { result: dated } = yield* milestones.update({ commandId: cmd(), id: m3.id, goal: "Watching agents", targetDate: "2026-12-01" })
      expect(dated).toMatchObject({ goal: "Watching agents", targetDate: "2026-12-01" })
      const { result: cleared } = yield* milestones.update({ commandId: cmd(), id: m3.id, targetDate: null })
      expect(cleared.targetDate).toBeNull()
      const updates = (yield* store.history(m3.id)).filter((e) => e.type === "milestone.updated")
      expect(updates.map((e) => e.type === "milestone.updated" && [e.before, e.after])).toEqual([
        [{ goal: "", targetDate: null }, { goal: "Watching agents", targetDate: "2026-12-01" }],
        [{ targetDate: "2026-12-01" }, { targetDate: null }],
      ])

      // Nothing to change: no event.
      expect((yield* milestones.update({ commandId: cmd(), id: m3.id, goal: "Watching agents" })).seq).toBeNull()

      // M4 first: before M2.
      yield* milestones.update({ commandId: cmd(), id: m4.id, after: m2.id })
      // M2 between M3 and nothing: last.
      yield* milestones.update({ commandId: cmd(), id: m2.id, before: m3.id })
      const order = (yield* (yield* SnapshotService.SnapshotService).get()).milestones!.map((m) => m.name)
      expect(order).toEqual(["M4", "M3", "M2"])
      expect(yield* Effect.flip(milestones.update({ commandId: cmd(), id: m2.id, before: "nope" }))).toMatchObject({ _tag: "Invalid", field: "before" })

      const { result: renamed } = yield* milestones.update({ commandId: cmd(), id: m4.id, name: "M1" })
      expect(renamed.name).toBe("M1")
      expect(yield* Effect.flip(milestones.update({ commandId: cmd(), id: m4.id, name: "m3" }))).toMatchObject({ _tag: "Invalid", field: "name" })
      // Its own name in another case is fine.
      expect((yield* milestones.update({ commandId: cmd(), id: m3.id, name: "m3" })).result.name).toBe("m3")
      expect(yield* Effect.flip(milestones.update({ commandId: cmd(), id: "nope", goal: "x" }))).toMatchObject({ _tag: "NotFound", entity: "milestone" })
    })))

  it.effect("agents create and edit; only the human closes and reopens, and closing twice changes nothing", () =>
    run(Effect.gen(function* () {
      const milestones = yield* MilestoneService.MilestoneService
      const store = yield* EventStore.EventStore
      const { project } = yield* setupProject
      const { result: m3 } = yield* agent(milestones.create({ commandId: cmd(), projectId: project.id, name: "M3" }))
      yield* agent(milestones.update({ commandId: cmd(), id: m3.id, goal: "Watching agents" }))

      expect(yield* Effect.flip(agent(milestones.close({ commandId: cmd(), id: m3.id })))).toMatchObject({
        _tag: "HumanOnly",
        action: "close a milestone",
        human: TEST_HUMAN,
      })

      const { result: closed } = yield* milestones.close({ commandId: cmd(), id: m3.id })
      expect(closed.state).toBe("closed")
      expect(closed.closedAt).not.toBeNull()
      expect((yield* milestones.close({ commandId: cmd(), id: m3.id })).seq).toBeNull()

      expect(yield* Effect.flip(agent(milestones.reopen({ commandId: cmd(), id: m3.id })))).toMatchObject({ _tag: "HumanOnly", action: "reopen a milestone" })
      const { result: reopened } = yield* milestones.reopen({ commandId: cmd(), id: m3.id })
      expect(reopened).toMatchObject({ state: "open", closedAt: null })
      expect((yield* milestones.reopen({ commandId: cmd(), id: m3.id })).seq).toBeNull()

      expect((yield* store.history(m3.id)).map((e) => e.type)).toEqual(["milestone.created", "milestone.updated", "milestone.closed", "milestone.reopened"])
    })))
})
