// A build's commit and the changes since the previous build, read from a real temp git repository.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { APP_VERSION } from "@cello/shared/version"
import { afterAll, describe, expect, it } from "vitest"
import { buildCommit, commitOf, subjectsBetween, webBuildStamp } from "./git.ts"

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-build-git-")))
afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}
const commit = (cwd: string, message: string) => {
  git(cwd, "commit", "-q", "--allow-empty", "-m", message)
  return git(cwd, "rev-parse", "--short", "HEAD")
}

const repo = path.join(base, "cello")
const outside = path.join(base, "outside")
fs.mkdirSync(repo)
fs.mkdirSync(outside)
git(repo, "init", "-q", "-b", "main")
const first = commit(repo, "init")
git(repo, "checkout", "-q", "-b", "feature")
commit(repo, "wip: inside the branch")
git(repo, "checkout", "-q", "main")
git(repo, "merge", "-q", "--no-ff", "feature", "-m", "merge: the reload bar (CEL-37)")
const last = commit(repo, "docs: what each column means")

describe("a build's commit", () => {
  it("is the checkout's short HEAD, or null outside one", () => {
    expect(commitOf(repo)).toBe(last)
    expect(commitOf(outside)).toBeNull()
  })

  it("is CELLO_BUILD_COMMIT when set, for builds outside a checkout (Docker)", () => {
    expect(buildCommit({ CELLO_BUILD_COMMIT: "aaaaaaa" }, repo)).toBe("aaaaaaa")
    expect(buildCommit({}, repo)).toBe(last)
    expect(buildCommit({ CELLO_BUILD_COMMIT: " " }, outside)).toBeNull()
  })
})

describe("the changes since the previous build", () => {
  it("are the first-parent subjects, newest first: merges, not the commits inside them", () => {
    expect(subjectsBetween(repo, first, last)).toEqual(["docs: what each column means", "merge: the reload bar (CEL-37)"])
  })

  it("are empty when git can't tell (an unknown commit, no checkout)", () => {
    expect(subjectsBetween(repo, "0000000", last)).toEqual([])
    expect(subjectsBetween(outside, first, last)).toEqual([])
  })
})

describe("a new web build's stamp", () => {
  const now = 1_763_230_740_000

  it("lists what changed since the previous build in the same folder", () => {
    const previous = { version: APP_VERSION, commit: first, builtAt: 1, changes: [] }
    expect(webBuildStamp({ dir: repo, env: {}, previous, now })).toEqual({
      version: APP_VERSION,
      commit: last,
      builtAt: now,
      changes: ["docs: what each column means", "merge: the reload bar (CEL-37)"],
    })
  })

  it("keeps the previous build's list when rebuilt at the same commit, and has none for a first build", () => {
    const previous = { version: APP_VERSION, commit: last, builtAt: 1, changes: ["merge: the reload bar (CEL-37)"] }
    expect(webBuildStamp({ dir: repo, env: {}, previous, now }).changes).toEqual(["merge: the reload bar (CEL-37)"])
    expect(webBuildStamp({ dir: repo, env: {}, previous: null, now }).changes).toEqual([])
    expect(webBuildStamp({ dir: outside, env: {}, previous, now })).toMatchObject({ commit: null, changes: [] })
  })
})
