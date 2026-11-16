// The release's deploy (CEL-36): back up the live board, then restart the background service, which runs
// this checkout's apps/cli/dist/cello (what ~/.local/bin/cello links to), so the build the release just made
// goes live. Skipped in a dry run and with --no-deploy; tests never run it for real.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

export const DEPLOY_STEPS: ReadonlyArray<ReadonlyArray<string>> = [
  ["cello", "backup"],
  ["cello", "service", "restart"],
]

export type Binaries = {
  /** The `cello` on PATH, symlinks resolved; null when there's none. */
  readonly live: string | null
  /** This checkout's build, apps/cli/dist/cello, symlinks resolved. */
  readonly built: string
}

/** Why deploying wouldn't put this build live, or null when it would. */
export const liveBinaryProblem = ({ live, built }: Binaries): string | null => {
  const byHand = "Deploy by hand: cello backup, then cello service restart with the cello you want the service to run."
  if (live === null) return `No cello on your PATH, so there's no live server to restart. ${byHand}`
  if (live !== built) {
    return `The cello on your PATH (${live}) isn't this checkout's build (${built}), so a restart wouldn't run the release. ${byHand}`
  }
  return null
}

export type Run = (cmd: ReadonlyArray<string>) => number

const inherit: Run = (cmd) => spawnSync(cmd[0]!, cmd.slice(1), { stdio: "inherit" }).status ?? 1

/** Backs up, then restarts; never restarts without a backup. Throws with what to do when a step fails. */
export const deploy = (binaries: Binaries, run: Run = inherit): void => {
  const problem = liveBinaryProblem(binaries)
  if (problem) throw new Error(problem)
  const [backup, restart] = DEPLOY_STEPS as [ReadonlyArray<string>, ReadonlyArray<string>]
  const backedUp = run(backup)
  if (backedUp !== 0) throw new Error(`cello backup failed (exit ${backedUp}): the live server wasn't restarted. Deploy again once it works.`)
  const restarted = run(restart)
  if (restarted !== 0) {
    throw new Error(
      `cello service restart failed (exit ${restarted}). The release is out; the live server isn't on it yet: cello service status says why.`,
    )
  }
}

const realpath = (file: string): string | null => {
  try {
    return fs.realpathSync(file)
  } catch {
    return null
  }
}

/** The live and built binaries for the checkout at `root`. */
export const binariesOf = (root: string): Binaries => {
  const which = spawnSync("which", ["cello"], { encoding: "utf8" })
  const live = which.status === 0 ? realpath(which.stdout.trim()) : null
  const built = path.join(root, "apps/cli/dist/cello")
  return { live, built: realpath(built) ?? built }
}
