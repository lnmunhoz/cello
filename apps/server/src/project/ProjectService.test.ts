import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as WorkspaceService from "../workspace/WorkspaceService.ts"
import { cmd } from "../testing/fixtures.ts"
import { asHuman, services } from "../testing/TestLayers.ts"
import * as ProjectService from "./ProjectService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

const setup = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService
  const snapshot = yield* (yield* SnapshotService.SnapshotService).get()
  const workspaceId = snapshot.workspaces[0]!.id
  const create = (input: Partial<ProjectService.CreateProject>) =>
    projects.create({ commandId: cmd(), workspaceId, name: "ThaiLookup", key: "THAI", ...input })
  return { projects, workspaceId, create }
})

describe("ProjectService keys", () => {
  it.effect("accepts keys matching ^[A-Z][A-Z0-9]{1,9}$ and rejects the rest", () =>
    run(Effect.gen(function* () {
      const { create } = yield* setup
      expect((yield* create({ key: "THAI" })).result.key).toBe("THAI")
      expect((yield* create({ key: "A1" })).result.key).toBe("A1")
      expect((yield* create({ key: "ABCDEFGHIJ" })).result.key).toBe("ABCDEFGHIJ")
      for (const key of ["T", "1AB", "ABCDEFGHIJK", "TH-AI", ""]) {
        expect(yield* Effect.flip(create({ key }))).toMatchObject({ _tag: "Invalid", field: "key" })
      }
    })))

  it.effect("a key is unique across workspaces: KeyTaken names the project that has it", () =>
    run(Effect.gen(function* () {
      const { create } = yield* setup
      yield* create({ key: "THAI", name: "ThaiLookup" })
      const { result: other } = yield* (yield* WorkspaceService.WorkspaceService).create({ commandId: cmd(), name: "Work" })
      const error = yield* Effect.flip(create({ key: "THAI", name: "Thai Again", workspaceId: other.id }))
      expect(error).toMatchObject({ _tag: "KeyTaken", key: "THAI", projectName: "ThaiLookup" })
    })))

  it.effect("keys are matched after trimming and uppercasing", () =>
    run(Effect.gen(function* () {
      const { create } = yield* setup
      yield* create({ key: "THAI" })
      expect(yield* Effect.flip(create({ key: " thai " }))).toMatchObject({ _tag: "KeyTaken", key: "THAI" })
    })))
})

describe("ProjectService", () => {
  it.effect("creates with a default color and a main repo path, which must be unused", () =>
    run(Effect.gen(function* () {
      const { create } = yield* setup
      const { result } = yield* create({ repoPath: "/code/thai" })
      expect(result).toMatchObject({ repoPath: "/code/thai", color: ProjectService.PROJECT_COLORS[0], description: "" })
      const error = yield* Effect.flip(create({ key: "OTHER", repoPath: "/code/thai" }))
      expect(error).toMatchObject({ _tag: "Invalid", field: "repoPath", reason: "already used by ThaiLookup" })
    })))

  it.effect("an unknown workspace is NotFound", () =>
    run(Effect.gen(function* () {
      const { create } = yield* setup
      expect(yield* Effect.flip(create({ workspaceId: "nope" }))).toMatchObject({ _tag: "NotFound", entity: "workspace" })
    })))

  it.effect("update records only what changed; archive is idempotent", () =>
    run(Effect.gen(function* () {
      const { projects, create } = yield* setup
      const { result: project } = yield* create({})
      const updated = yield* projects.update({ commandId: cmd(), id: project.id, name: "ThaiLookup", description: "Thai" })
      expect(updated.result.description).toBe("Thai")
      expect(updated.seq).not.toBeNull()
      expect((yield* projects.update({ commandId: cmd(), id: project.id, description: "Thai" })).seq).toBeNull()
      expect(yield* Effect.flip(projects.update({ commandId: cmd(), id: project.id, color: "red" }))).toMatchObject({
        _tag: "Invalid",
        field: "color",
      })

      const archived = yield* projects.archive({ commandId: cmd(), id: project.id })
      expect(archived.result.archivedAt).not.toBeNull()
      expect((yield* projects.archive({ commandId: cmd(), id: project.id })).seq).toBeNull()
    })))
})

describe("ProjectService.resolve", () => {
  it.effect("finds a project by key, or by the repository folder linked to it", () =>
    run(Effect.gen(function* () {
      const projects = yield* ProjectService.ProjectService
      const workspaceId = (yield* (yield* SnapshotService.SnapshotService).get()).workspaces[0]!.id
      const { result: cello } = yield* projects.create({
        commandId: cmd(),
        workspaceId,
        name: "Cello",
        key: "CEL",
        repoPath: "/Users/lnmunhoz/projects/cello",
      })
      expect(yield* projects.resolve({ key: "cel" })).toEqual(cello)
      expect(yield* projects.resolve({ repoPath: "/Users/lnmunhoz/projects/cello" })).toEqual(cello)
      // A key wins over the folder.
      yield* projects.create({ commandId: cmd(), workspaceId, name: "Other", key: "OTH" })
      expect((yield* projects.resolve({ key: "OTH", repoPath: "/Users/lnmunhoz/projects/cello" })).key).toBe("OTH")
    })))

  it.effect("an unknown key or folder is NotFound, and an empty reference is Invalid", () =>
    run(Effect.gen(function* () {
      const projects = yield* ProjectService.ProjectService
      expect(yield* Effect.flip(projects.resolve({ key: "NOPE" }))).toMatchObject({ _tag: "NotFound", entity: "project", id: "NOPE" })
      expect(yield* Effect.flip(projects.resolve({ repoPath: "/tmp/elsewhere" }))).toMatchObject({
        _tag: "NotFound",
        entity: "project",
        id: "/tmp/elsewhere",
      })
      expect(yield* Effect.flip(projects.resolve({}))).toMatchObject({ _tag: "Invalid", field: "project" })
    })))
})
