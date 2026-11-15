// A project's folder, spelled one way: `~` expanded, symlinks resolved (on macOS /tmp is /private/tmp),
// no trailing slash, and a folder inside a git repository is that repository's main checkout. The same
// repo typed differently in New project, or reached from a worktree, is the same path.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Effect from "effect/Effect"
import { afterAll, describe, expect, it } from "vitest"
import { cachedLayer, normalizeRepoPath, RepoPaths, repoRootFor } from "./repoPath.ts"

const git = (cwd: string, ...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-repopath-")))
afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

describe("normalizeRepoPath", () => {
  const repo = path.join(base, "projects", "thai")
  fs.mkdirSync(path.join(repo, "apps", "web"), { recursive: true })
  git(repo, "init", "-q", "-b", "main")
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
  const worktree = path.join(base, "thai-feature")
  git(repo, "worktree", "add", "-q", worktree)
  const alias = path.join(base, "alias")
  fs.symlinkSync(path.join(base, "projects"), alias)
  const plain = path.join(base, "notes")
  fs.mkdirSync(plain)

  it("is the same for every spelling of one repository", async () => {
    for (const spelling of [repo, `${repo}/`, `${repo}//`, "~/projects/thai", "~/projects/thai/", path.join(alias, "thai"), path.join(repo, "apps", "web"), worktree]) {
      expect(await normalizeRepoPath(spelling, base), spelling).toBe(repo)
    }
  })

  it("a folder outside git is itself, resolved; a missing one keeps the part that doesn't exist yet", async () => {
    expect(await normalizeRepoPath(`${plain}/`, base)).toBe(plain)
    expect(await normalizeRepoPath("~", base)).toBe(base)
    expect(await normalizeRepoPath(path.join(alias, "not-yet", "x/"), base)).toBe(path.join(base, "projects", "not-yet", "x"))
    expect(await normalizeRepoPath("/code/thai/", base)).toBe("/code/thai")
  })

  it("repoRootFor is the main checkout, from a subfolder or a worktree, and null outside git", () => {
    expect(repoRootFor(path.join(repo, "apps"))).toBe(repo)
    expect(repoRootFor(worktree)).toBe(repo)
    expect(repoRootFor(plain)).toBeNull()
  })
})

describe("RepoPaths (cached)", () => {
  it("normalizes each path once, by the string it was given: a second lookup, or one at the same time, doesn't run git again", async () => {
    const calls: string[] = []
    const layer = cachedLayer(async (raw) => {
      calls.push(raw)
      return raw.replace(/\/+$/, "")
    })
    const results = await Effect.runPromise(Effect.gen(function* () {
      const { normalize } = yield* RepoPaths
      const first = yield* Effect.all([normalize("/a/"), normalize("/a/")], { concurrency: "unbounded" })
      return [...first, yield* normalize("/a/"), yield* normalize("/b")]
    }).pipe(Effect.provide(layer)))
    expect(results).toEqual(["/a", "/a", "/a", "/b"])
    expect(calls).toEqual(["/a/", "/b"])
  })
})
