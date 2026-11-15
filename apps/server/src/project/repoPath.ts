// A project's folder, spelled one way, so one repository typed differently (New project, `cello init`,
// a worktree, an old row) is one path: `~` expanded, symlinks resolved (on macOS /tmp is /private/tmp),
// no trailing slash, and a folder inside a git repository is that repository's main checkout. The CLI
// and the server run on the same machine, so both can look at the folder.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

const GIT_COMMON_DIR = ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]

/** The main checkout from `git rev-parse --git-common-dir`'s output; a bare repository is its git dir. */
const checkoutOf = (output: string): string => {
  const commonDir = fs.realpathSync(output.trim())
  return path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir
}

/**
 * The main checkout of the repository `dir` is in, so a linked worktree resolves to the repository it
 * belongs to. Null outside a repository (or without git). Synchronous, for the CLI.
 */
export const repoRootFor = (dir: string): string | null => {
  try {
    const result = Bun.spawnSync(GIT_COMMON_DIR, { cwd: dir, stdout: "pipe", stderr: "ignore" })
    return result.exitCode === 0 ? checkoutOf(result.stdout.toString()) : null
  } catch {
    return null
  }
}

/** repoRootFor without blocking: the server keeps answering other requests while git runs. */
const repoRootForAsync = async (dir: string): Promise<string | null> => {
  try {
    const child = Bun.spawn(GIT_COMMON_DIR, { cwd: dir, stdout: "pipe", stderr: "ignore" })
    const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    return code === 0 ? checkoutOf(output) : null
  } catch {
    return null
  }
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

/** The one spelling of a project folder. `home` is what `~` means (the server's HOME). Never fails. */
export const normalizeRepoPath = async (raw: string, home: string = os.homedir()): Promise<string> => {
  const trimmed = raw.trim()
  const expanded = trimmed === "~" ? home : trimmed.startsWith("~/") ? path.join(home, trimmed.slice(2)) : trimmed
  const real = realpathOfExisting(path.resolve(expanded))
  const isDir = fs.statSync(real, { throwIfNoEntry: false })?.isDirectory() ?? false
  return (isDir ? await repoRootForAsync(real) : null) ?? real
}

/** Normalizes project folders for the server (see normalizeRepoPath). */
export class RepoPaths extends Context.Service<RepoPaths, {
  readonly normalize: (raw: string) => Effect.Effect<string>
}>()("cello/RepoPaths") {}

/**
 * RepoPaths over `normalize`, remembering each answer by the exact string it was given for as long as
 * the server runs: stored rows never change their text, and a CLI sends the same folder every call, so
 * git runs once per path, not once per row on every lookup. Lookups of one path at the same time share it.
 */
export const cachedLayer = (normalize: (raw: string) => Promise<string>) =>
  Layer.sync(RepoPaths, () => {
    const known = new Map<string, Promise<string>>()
    return RepoPaths.of({
      normalize: (raw) =>
        Effect.promise(() => {
          const answer = known.get(raw) ?? normalize(raw)
          known.set(raw, answer)
          return answer
        }),
    })
  })

export const layer = cachedLayer((raw) => normalizeRepoPath(raw))
