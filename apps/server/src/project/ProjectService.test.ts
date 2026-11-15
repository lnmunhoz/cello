import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as WorkspaceService from "../workspace/WorkspaceService.ts"
import { cmd } from "../testing/fixtures.ts"
import { asHuman, services } from "../testing/TestLayers.ts"
import * as ProjectService from "./ProjectService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

const tempBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-projects-")))
afterAll(() => fs.rmSync(tempBase, { recursive: true, force: true }))

/** A git repo `<dir>/projects/thai` with a src folder, and `<dir>/alias`, a symlink to `<dir>/projects`. */
const tempRepo = () => {
  const dir = fs.mkdtempSync(path.join(tempBase, "r-"))
  const repo = path.join(dir, "projects", "thai")
  fs.mkdirSync(path.join(repo, "src"), { recursive: true })
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repo })
  const alias = path.join(dir, "alias")
  fs.symlinkSync(path.join(dir, "projects"), alias)
  return { repo, alias }
}

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

  it.effect("without a key, the project gets a free one made from its name, also against other workspaces' and archived keys", () =>
    run(Effect.gen(function* () {
      const { create, projects, workspaceId } = yield* setup
      const first = (yield* projects.create({ commandId: cmd(), workspaceId, name: "cello" })).result
      expect(first.key).toBe("CEL")
      yield* projects.archive({ commandId: cmd(), id: first.id })
      const { result: other } = yield* (yield* WorkspaceService.WorkspaceService).create({ commandId: cmd(), name: "Work" })
      yield* create({ key: "CELL", name: "Cell", workspaceId: other.id })
      const second = (yield* projects.create({ commandId: cmd(), workspaceId, name: "cello" })).result
      expect(second.key).toBe("CELLO")
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

  it.effect("a repo path is stored normalized, and one spelling of a folder finds a project made with another", () =>
    run(Effect.gen(function* () {
      const { create, projects } = yield* setup
      const { repo, alias } = tempRepo()
      const { result } = yield* create({ repoPath: `${path.join(alias, "thai")}/` })
      expect(result.repoPath).toBe(repo)
      for (const spelling of [repo, `${repo}/`, path.join(repo, "src"), path.join(alias, "thai")]) {
        expect((yield* projects.resolve({ repoPath: spelling })).id, spelling).toBe(result.id)
      }
      // Any spelling of a held path is refused, archived holders included, and the reason says so.
      expect(yield* Effect.flip(create({ key: "TWO", repoPath: path.join(repo, "src") }))).toMatchObject({
        _tag: "Invalid",
        field: "repoPath",
        reason: "already used by ThaiLookup",
      })
      yield* projects.archive({ commandId: cmd(), id: result.id })
      expect(yield* Effect.flip(create({ key: "TWO", repoPath: `${repo}/` }))).toMatchObject({
        _tag: "Invalid",
        field: "repoPath",
        reason: "already used by ThaiLookup (archived)",
      })
    })))

  it.effect("rows stored before paths were normalized still match, and still block a second project", () =>
    run(Effect.gen(function* () {
      const { create, projects } = yield* setup
      const sql = yield* SqlClient.SqlClient
      const { repo, alias } = tempRepo()
      const { result } = yield* create({ repoPath: repo })
      yield* sql`UPDATE project_repos SET path = ${`${path.join(alias, "thai", "src")}/`} WHERE project_id = ${result.id}`
      expect((yield* projects.resolve({ repoPath: repo })).id).toBe(result.id)
      expect(yield* Effect.flip(create({ key: "TWO", repoPath: repo }))).toMatchObject({ _tag: "Invalid", field: "repoPath" })
    })))

  it.effect("two live projects on one repository (old rows) make the folder ambiguous: Invalid names both", () =>
    run(Effect.gen(function* () {
      const { create, projects } = yield* setup
      const sql = yield* SqlClient.SqlClient
      const { repo } = tempRepo()
      const { result: thai } = yield* create({ repoPath: repo })
      const { result: web } = yield* create({ key: "WEB", name: "Web", repoPath: "/code/web" })
      yield* sql`UPDATE project_repos SET path = ${`${repo}/`} WHERE project_id = ${thai.id}`
      yield* sql`UPDATE project_repos SET path = ${path.join(repo, "src")} WHERE project_id = ${web.id}`
      expect(yield* Effect.flip(projects.resolve({ repoPath: repo }))).toMatchObject({
        _tag: "Invalid",
        field: "project",
        reason: "several projects use this folder (THAI, WEB); pass --project KEY",
      })
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
