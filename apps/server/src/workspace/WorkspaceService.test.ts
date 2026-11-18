import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import { DEFAULT_STATUSES } from "../status/defaults.ts"
import { cmd } from "../testing/fixtures.ts"
import { asHuman, services } from "../testing/TestLayers.ts"
import * as WorkspaceService from "./WorkspaceService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

describe("workspaceSlug", () => {
  it("lowercases and dashes words", () => {
    expect(WorkspaceService.workspaceSlug("My Side Projects!")).toBe("my-side-projects")
    expect(WorkspaceService.workspaceSlug("???")).toBe("workspace")
  })
})

describe("WorkspaceService", () => {
  it.effect("create gives a unique slug, sorts after the others and starts with the default statuses", () =>
    run(Effect.gen(function* () {
      const workspaces = yield* WorkspaceService.WorkspaceService
      const { result: first } = yield* workspaces.create({ commandId: cmd(), name: "Personal" })
      const { result: second } = yield* workspaces.create({ commandId: cmd(), name: "Personal" })
      expect([first.slug, second.slug]).toEqual(["personal-2", "personal-3"])
      const snapshot = yield* (yield* SnapshotService.SnapshotService).get({ workspaceId: second.id })
      expect(snapshot.workspaces.map((w) => w.id).slice(-2)).toEqual([first.id, second.id])
      expect(snapshot.statuses.map((s) => s.name)).toEqual(DEFAULT_STATUSES.map((s) => s.name))
    })))

  it.effect("update renames; an empty name is Invalid; an unknown id is NotFound", () =>
    run(Effect.gen(function* () {
      const workspaces = yield* WorkspaceService.WorkspaceService
      const { result } = yield* workspaces.create({ commandId: cmd(), name: "Work" })
      expect((yield* workspaces.update({ commandId: cmd(), id: result.id, name: "Job" })).result.name).toBe("Job")
      expect(yield* Effect.flip(workspaces.update({ commandId: cmd(), id: result.id, name: " " }))).toMatchObject({
        _tag: "Invalid",
      })
      expect(yield* Effect.flip(workspaces.update({ commandId: cmd(), id: "nope", name: "X" }))).toMatchObject({
        _tag: "NotFound",
      })
    })))
})
