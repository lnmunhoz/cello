import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as WorkspaceService from "../workspace/WorkspaceService.ts"
import { cmd } from "../testing/fixtures.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as ProjectService from "./ProjectService.ts"
import * as RepoPaths from "./repoPath.ts"

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

  it.effect("refuses a key that's one of the board's own top-level pages, which its board would hide behind (CEL-50)", () =>
    run(Effect.gen(function* () {
      const { create } = yield* setup
      for (const key of ["BUILDS", "settings", "Review"]) {
        const error = yield* Effect.flip(create({ key }))
        expect(error).toMatchObject({ _tag: "Invalid", field: "key" })
        expect((error as { reason: string }).reason).toMatch(/^can't be (BUILDS|SETTINGS|REVIEW), the address of Cello's/)
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

// CEL-143: "Merge after I approve". New projects with a repository (an agent has somewhere to merge, the
// way `cello init` makes them) start with it on; projects without one, and every project on the board
// before the setting (the migration), start off. Only the human changes it.
describe("ProjectService: merge after I approve", () => {
  it.effect("is on for a new project with a repository folder, off for one without, unless the creator says", () =>
    run(Effect.gen(function* () {
      const { create } = yield* setup
      const { repo } = tempRepo()
      expect((yield* create({ key: "THAI", repoPath: repo })).result.mergeAfterApproval).toBe(true)
      expect((yield* create({ key: "NOREPO" })).result.mergeAfterApproval).toBe(false)
      expect((yield* create({ key: "OFF", repoPath: tempRepo().repo, mergeAfterApproval: false })).result.mergeAfterApproval).toBe(false)
      expect((yield* create({ key: "ON", mergeAfterApproval: true })).result.mergeAfterApproval).toBe(true)
      // The snapshot carries it, so the board and the Review page know it.
      const snapshot = yield* (yield* SnapshotService.SnapshotService).get()
      expect(Object.fromEntries(snapshot.projects.map((p) => [p.key, p.mergeAfterApproval]))).toMatchObject({ THAI: true, NOREPO: false, OFF: false, ON: true })
    })))

  it.effect("the human switches it on and off; an agent can't, and an unchanged value records nothing", () =>
    run(Effect.gen(function* () {
      const { projects, create } = yield* setup
      const { result: project } = yield* create({})
      const on = yield* projects.update({ commandId: cmd(), id: project.id, mergeAfterApproval: true })
      expect(on.result.mergeAfterApproval).toBe(true)
      expect(on.seq).not.toBeNull()
      expect((yield* projects.update({ commandId: cmd(), id: project.id, mergeAfterApproval: true })).seq).toBeNull()

      const agent = asAgent({ session: "session-project", client: "Claude Code", pid: process.pid })
      expect(yield* Effect.flip(agent(projects.update({ commandId: cmd(), id: project.id, mergeAfterApproval: false })))).toMatchObject({
        _tag: "HumanOnly",
        action: "change whether agents merge after you approve",
      })
      // The rest of a project an agent may still change, as before.
      expect((yield* agent(projects.update({ commandId: cmd(), id: project.id, description: "Thai" }))).result.description).toBe("Thai")

      const off = yield* projects.update({ commandId: cmd(), id: project.id, mergeAfterApproval: false })
      expect(off.result.mergeAfterApproval).toBe(false)
      const sql = yield* SqlClient.SqlClient
      const events = yield* sql<{ payload: string }>`SELECT payload FROM events WHERE type = 'project.updated' ORDER BY seq`
      expect(events.map((e) => JSON.parse(e.payload)).filter((p) => "mergeAfterApproval" in p.after).map((p) => [p.before, p.after])).toEqual([
        [{ mergeAfterApproval: false }, { mergeAfterApproval: true }],
        [{ mergeAfterApproval: true }, { mergeAfterApproval: false }],
      ])
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

  it.effect("a lookup that misses doesn't normalize stored rows again: each path is normalized once per server", () => {
    const calls: string[] = []
    const counting = RepoPaths.cachedLayer(async (raw) => {
      calls.push(raw)
      return RepoPaths.normalizeRepoPath(raw)
    })
    return asHuman(Effect.gen(function* () {
      const { create, projects } = yield* setup
      const sql = yield* SqlClient.SqlClient
      const { repo } = tempRepo()
      const { result } = yield* create({ repoPath: repo })
      // An old row, spelled another way, so a miss has to look at it.
      yield* sql`UPDATE project_repos SET path = ${`${repo}/`} WHERE project_id = ${result.id}`
      const elsewhere = path.join(path.dirname(repo), "elsewhere")
      yield* Effect.flip(projects.resolve({ repoPath: elsewhere }))
      expect(calls).toContain(`${repo}/`)
      const before = calls.length
      yield* Effect.flip(projects.resolve({ repoPath: elsewhere }))
      expect((yield* projects.resolve({ repoPath: repo })).id).toBe(result.id)
      expect((yield* projects.resolve({ repoPath: repo })).id).toBe(result.id)
      // `repo` itself was normalized when the project was created.
      expect(calls.slice(before)).toEqual([])
    })).pipe(Effect.provide(services({ repoPaths: counting }))) as Effect.Effect<void>
  })

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
