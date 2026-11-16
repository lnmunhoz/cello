// The release's deploy (CEL-36). The release builds `cello` into release/stage/cello, never over the live
// apps/cli/dist/cello (what ~/.local/bin/cello links to and the launchd service runs), so a release that
// fails or skips the deploy leaves the live binary untouched. Deploying then:
//   1. cello backup, with the old cello, against the running server
//   2. renames the staged build over apps/cli/dist/cello: one rename on one filesystem (both live in the
//      checkout), so the live file is the old build or the new one, never half written
//   3. cello service restart: the service runs the new build, and a migration runs then, after the backup
// Skipped in a dry run and with --no-deploy; tests never run it for real.
//
//   bun scripts/release/deploy.ts      deploy the staged build by hand (after --no-deploy, or a failed release)
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { STAGED_CLI } from "./artifacts.ts"

export type Binaries = {
  /** The `cello` on PATH, symlinks resolved; null when there's none. */
  readonly live: string | null
  /** This checkout's build, apps/cli/dist/cello, symlinks resolved. */
  readonly built: string
}

export type DeployPlan = Binaries & {
  /** The release's build, release/stage/cello. */
  readonly staged: string
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

/** Puts the staged build live: a rename, so the live path switches from the old file to the new one at once. */
export const installStaged = (staged: string, live: string): void => {
  if (!fs.existsSync(staged)) throw new Error(`No staged build at ${staged}: the release's build didn't run or was moved.`)
  fs.mkdirSync(path.dirname(live), { recursive: true })
  fs.renameSync(staged, live)
}

export type Run = (cmd: ReadonlyArray<string>) => number

const inherit: Run = (cmd) => spawnSync(cmd[0]!, cmd.slice(1), { stdio: "inherit" }).status ?? 1

/** Backs up, puts the staged build live, restarts; nothing goes live without a backup. Throws with what to do. */
export const deploy = (plan: DeployPlan, run: Run = inherit, install = installStaged): void => {
  const problem = liveBinaryProblem(plan)
  if (problem) throw new Error(problem)
  const backedUp = run(["cello", "backup"])
  if (backedUp !== 0) {
    throw new Error(
      `cello backup failed (exit ${backedUp}): the live cello and server weren't touched. Deploy again once it works: bun scripts/release/deploy.ts`,
    )
  }
  install(plan.staged, plan.built)
  const restarted = run(["cello", "service", "restart"])
  if (restarted !== 0) {
    throw new Error(
      `cello service restart failed (exit ${restarted}). The release is out and its cello is in place; the live server isn't on it yet: cello service status says why.`,
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

export const deployPlanOf = (root: string): DeployPlan => ({ ...binariesOf(root), staged: path.join(root, STAGED_CLI) })

if (import.meta.main) {
  try {
    deploy(deployPlanOf(path.join(import.meta.dirname, "../..")))
    console.log("Deployed: the staged cello is live and the service restarted on it.")
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
