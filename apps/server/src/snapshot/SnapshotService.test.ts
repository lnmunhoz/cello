import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as ProjectService from "../project/ProjectService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services, TEST_HUMAN } from "../testing/TestLayers.ts"
import * as WorkspaceService from "../workspace/WorkspaceService.ts"
import * as SnapshotService from "./SnapshotService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

describe("SnapshotService.get", () => {
  it.effect("with no scope, returns the first non-archived workspace by position, and lists every workspace", () =>
    run(Effect.gen(function* () {
      const snapshots = yield* SnapshotService.SnapshotService
      const { workspace, project } = yield* setupProject
      yield* (yield* TaskService.TaskService).create({ commandId: cmd(), projectId: project.id, title: "T" })
      const { result: work } = yield* (yield* WorkspaceService.WorkspaceService).create({ commandId: cmd(), name: "Work" })
      yield* (yield* ProjectService.ProjectService).create({ commandId: cmd(), workspaceId: work.id, name: "Job", key: "JOB" })

      const snapshot = yield* snapshots.get()
      expect(snapshot.workspaces.map((w) => w.name)).toEqual(["Personal", "Work"])
      expect(snapshot.projects.map((p) => p.key)).toEqual(["CEL"])
      expect(snapshot.statuses.every((s) => s.workspaceId === workspace.id)).toBe(true)
      expect(snapshot.tasks.map((t) => t.key)).toEqual(["CEL-1"])
      expect(snapshot.actors.map((a) => a.name)).toEqual([TEST_HUMAN])
      expect(snapshot.seq).toBeGreaterThan(0)
    })))

  it.effect("a workspace scope returns that workspace's board; workspaces still lists them all", () =>
    run(Effect.gen(function* () {
      const snapshots = yield* SnapshotService.SnapshotService
      yield* setupProject
      const { result: work } = yield* (yield* WorkspaceService.WorkspaceService).create({ commandId: cmd(), name: "Work" })
      const snapshot = yield* snapshots.get({ workspaceId: work.id })
      expect(snapshot.workspaces.map((w) => w.name)).toEqual(["Personal", "Work"])
      expect(snapshot.projects).toEqual([])
      expect(snapshot.statuses.every((s) => s.workspaceId === work.id)).toBe(true)
    })))

  it.effect("a project scope returns only that project and its tasks", () =>
    run(Effect.gen(function* () {
      const snapshots = yield* SnapshotService.SnapshotService
      const { workspace, project } = yield* setupProject
      const { result: other } = yield* (yield* ProjectService.ProjectService).create({
        commandId: cmd(),
        workspaceId: workspace.id,
        name: "Other",
        key: "OTH",
      })
      yield* (yield* TaskService.TaskService).create({ commandId: cmd(), projectId: other.id, title: "Elsewhere" })
      const snapshot = yield* snapshots.get({ projectId: project.id })
      expect(snapshot.projects.map((p) => p.key)).toEqual(["CEL"])
      expect(snapshot.tasks).toEqual([])
    })))

  it.effect("carries the agent sessions its tasks name (creator, claim, last change), and no others", () =>
    run(Effect.gen(function* () {
      const snapshots = yield* SnapshotService.SnapshotService
      const tasks = yield* TaskService.TaskService
      const { project } = yield* setupProject
      const maker = { session: "maker", client: "Claude Code", pid: process.pid }
      const holder = { session: "holder", client: "Claude Code", pid: process.pid }
      const { result: task } = yield* asAgent(maker)(tasks.create({ commandId: cmd(), projectId: project.id, title: "Made by an agent" }))
      yield* asAgent(holder)(tasks.claim({ commandId: cmd(), key: task.key }))
      yield* asAgent({ session: "bystander", client: "Claude Code" })(Effect.void)

      const snapshot = yield* snapshots.get()
      expect(snapshot.sessions.map((s) => s.externalId).sort()).toEqual(["holder", "maker"])
    })))

  it.effect("an unknown workspace or project scope is NotFound", () =>
    run(Effect.gen(function* () {
      const snapshots = yield* SnapshotService.SnapshotService
      expect(yield* Effect.flip(snapshots.get({ workspaceId: "nope" }))).toMatchObject({ _tag: "NotFound", entity: "workspace" })
      expect(yield* Effect.flip(snapshots.get({ projectId: "nope" }))).toMatchObject({ _tag: "NotFound", entity: "project" })
    })))
})
