// A build's git facts (CEL-37): the commit it's made from and what changed since the previous build.
// Used where builds are made: the web app's `vite build` (apps/web/buildStamp.ts), `bun run build` in
// apps/cli, and `cello start` or the dev server run from source. Vite runs under Bun (the web app's
// scripts are `bun --bun vite`, CEL-175), so builds don't depend on the shell's Node. `node:child_process`
// stays because both runtimes have it.
import { spawnSync } from "node:child_process"
import type { WebBuild } from "@cello/contract/build"
import { APP_VERSION } from "@cello/shared/version"

/** A full or abbreviated commit hash, the only thing that reaches git from build.json or the environment. */
export const isCommit = (value: string): boolean => /^[0-9a-f]{7,40}$/.test(value)

const git = (dir: string, args: ReadonlyArray<string>): string | null => {
  try {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 })
    return result.status === 0 ? result.stdout.trim() : null
  } catch {
    return null
  }
}

/** The short HEAD of the checkout `dir` is in, or null outside one (or without git). */
export const commitOf = (dir: string): string | null => git(dir, ["rev-parse", "--short", "HEAD"]) || null

/** The build's commit: CELLO_BUILD_COMMIT when it's a commit hash (builds outside a checkout, like Docker's), else `dir`'s HEAD. */
export const buildCommit = (env: Readonly<Record<string, string | undefined>>, dir: string): string | null => {
  const given = env.CELLO_BUILD_COMMIT?.trim() ?? ""
  return isCommit(given) ? given : commitOf(dir)
}

/**
 * First-parent commit subjects in `from..to`, newest first, at most `limit`; null when git can't tell (no
 * checkout at `dir`, a commit it doesn't have), which is not the same as nothing in between (empty).
 */
export const commitsBetween = (dir: string, from: string, to: string, limit = 50): ReadonlyArray<string> | null => {
  if (!isCommit(from) || !isCommit(to)) return null
  const out = git(dir, ["log", "--first-parent", `--max-count=${limit}`, "--format=%s", "--end-of-options", `${from}..${to}`])
  return out === null ? null : out.split("\n").filter((line) => line !== "")
}

/** `commitsBetween`, empty when git can't tell. */
export const subjectsBetween = (dir: string, from: string, to: string, limit = 50): ReadonlyArray<string> =>
  commitsBetween(dir, from, to, limit) ?? []

/**
 * The stamp for a web build made now in checkout `dir`. Its changes are what happened since `previous`,
 * the build that was in the same output folder: rebuilt at the same commit, it keeps that build's list.
 */
export const webBuildStamp = (input: {
  readonly dir: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly previous: WebBuild | null
  readonly now: number
}): WebBuild => {
  const commit = buildCommit(input.env, input.dir)
  const previous = input.previous
  const changes = previous === null || previous.commit === null || commit === null
    ? []
    : previous.commit === commit
    ? previous.changes
    : subjectsBetween(input.dir, previous.commit, commit)
  return { version: APP_VERSION, commit, builtAt: input.now, changes }
}
