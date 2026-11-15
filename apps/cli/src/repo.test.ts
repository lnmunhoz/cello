// Test 3 (CLI side): the project folder is the main checkout, found through git's common dir, from
// the repository root, a subfolder, or a linked worktree.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { checkoutRootFor, repoRootFor } from "./repo.ts"

const git = (cwd: string, ...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-repo-")))
afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

describe("repoRootFor", () => {
  const main = path.join(base, "cello")
  fs.mkdirSync(path.join(main, "apps", "cli"), { recursive: true })
  git(main, "init", "-q", "-b", "main")
  git(main, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
  const worktree = path.join(base, "cello-feature")
  git(main, "worktree", "add", "-q", worktree)

  it("is the main checkout from its root, a subfolder, or a linked worktree", () => {
    expect(repoRootFor(main)).toBe(main)
    expect(repoRootFor(path.join(main, "apps", "cli"))).toBe(main)
    expect(repoRootFor(worktree)).toBe(main)
  })

  it("is null outside a repository", () => {
    expect(repoRootFor(base)).toBeNull()
    expect(checkoutRootFor(base)).toBeNull()
  })

  it("checkoutRootFor is the checkout itself: a linked worktree stays the worktree", () => {
    expect(checkoutRootFor(path.join(main, "apps", "cli"))).toBe(main)
    expect(checkoutRootFor(worktree)).toBe(worktree)
  })
})
