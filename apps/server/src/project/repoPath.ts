// A project's folder, spelled one way, so one repository typed differently (New project, `cello init`,
// a worktree, an old row) is one path: `~` expanded, symlinks resolved (on macOS /tmp is /private/tmp),
// no trailing slash, and a folder inside a git repository is that repository's main checkout. The CLI
// and the server run on the same machine, so both can look at the folder.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

/**
 * The main checkout of the repository `dir` is in: the parent of `git rev-parse --git-common-dir`, so a
 * linked worktree resolves to the repository it belongs to. Null outside a repository (or without git).
 */
export const repoRootFor = (dir: string): string | null => {
  let result: ReturnType<typeof Bun.spawnSync>
  try {
    result = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, stdout: "pipe", stderr: "ignore" })
  } catch {
    return null
  }
  if (result.exitCode !== 0 || !result.stdout) return null
  const commonDir = fs.realpathSync(result.stdout.toString().trim())
  // A bare repository has no checkout around its git dir; use the git dir itself.
  return path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir
}

/** `p` with symlinks resolved in the part of it that exists; the rest (not created yet) is kept as written. */
const realpathOfExisting = (p: string): string => {
  const missing: string[] = []
  let current = p
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...missing.reverse())
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return p
      missing.push(path.basename(current))
      current = parent
    }
  }
}

/** The one spelling of a project folder. `home` is what `~` means (the server's HOME). */
export const normalizeRepoPath = (raw: string, home: string = os.homedir()): string => {
  const trimmed = raw.trim()
  const expanded = trimmed === "~" ? home : trimmed.startsWith("~/") ? path.join(home, trimmed.slice(2)) : trimmed
  const real = realpathOfExisting(path.resolve(expanded))
  const isDir = fs.statSync(real, { throwIfNoEntry: false })?.isDirectory() ?? false
  return (isDir ? repoRootFor(real) : null) ?? real
}
