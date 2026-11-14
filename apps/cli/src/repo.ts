// The project folder for a working directory: the main checkout, i.e. the parent of
// `git rev-parse --git-common-dir`, so a linked worktree resolves to the repository it belongs to.
import * as fs from "node:fs"
import * as path from "node:path"

export const repoRootFor = (cwd: string): string | null => {
  const result = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  })
  if (result.exitCode !== 0) return null
  const commonDir = fs.realpathSync(result.stdout.toString().trim())
  // A bare repository has no checkout around its git dir; use the git dir itself.
  return path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir
}
