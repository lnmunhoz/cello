// What `bun run package -- --install` does once the app is in /Applications (CEL-75): gathers the facts (git
// checkouts, LaunchServices' registrations, running processes) and runs src/install/plan.ts's plan. Only
// unregisters copies from LaunchServices; it never deletes an app or quits a running Cello. The app is a flavor's
// (CEL-149): Cello Dev, /Applications/Cello Dev.app, unless the package said --flavor release.
import * as fs from "node:fs"
import * as path from "node:path"
import { flavorArg } from "@cello/shared/flavor"
import { appIdentity, type AppIdentity } from "../src/flavor.ts"
import {
  checkoutRoots,
  findBuildCopies,
  LSREGISTER,
  lsregisterCommands,
  outdatedWarnings,
  parseCelloProcesses,
  parseRegisteredApps,
  parseWorktreeList,
  strayCopies,
  type DirEntry,
} from "../src/install/plan.ts"
import { desktopDir } from "./electron.ts"

/** A command's stdout ("" when it fails), in the C locale so `ps` dates read the same everywhere. */
const output = (cmd: string[]): string => {
  const result = Bun.spawnSync(cmd, { cwd: desktopDir, env: { ...process.env, LC_ALL: "C" }, stdout: "pipe", stderr: "ignore" })
  return result.exitCode === 0 ? result.stdout.toString() : ""
}

const readDir = (dir: string): DirEntry[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
  } catch {
    return []
  }
}

export interface AfterInstallPlan {
  readonly strays: readonly string[]
  readonly commands: readonly string[][]
  readonly warnings: readonly string[]
}

/** Reads the machine and returns what to do; changes nothing. */
export const planAfterInstall = (identity: AppIdentity, installedAt: Date): AfterInstallPlan => {
  const installed = identity.installedApp
  // The main checkout, also from inside a worktree: its .git is the common dir.
  const commonDir = output(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()
  const mainRoot = commonDir ? path.dirname(commonDir) : path.resolve(desktopDir, "../..")
  const roots = checkoutRoots({ mainRoot, worktrees: parseWorktreeList(output(["git", "worktree", "list", "--porcelain"])), readDir })
  const strays = strayCopies({
    mainRoot,
    roots,
    registered: parseRegisteredApps(output([LSREGISTER, "-dump"])),
    onDisk: findBuildCopies(roots, readDir),
    installed,
  })
  const processes = parseCelloProcesses(output(["ps", "-axo", "pid=,lstart=,comm="]), identity)
  return { strays, commands: lsregisterCommands(strays, installed), warnings: outdatedWarnings({ processes, identity, installedAt }) }
}

/** Runs the plan: the lsregister commands (a failure is reported, not fatal), then the warnings. */
export const afterInstall = (identity: AppIdentity, installedAt: Date): void => {
  const plan = planAfterInstall(identity, installedAt)
  for (const command of plan.commands) {
    const result = Bun.spawnSync(command, { stdout: "ignore", stderr: "pipe" })
    const [, flag, target] = command
    if (result.exitCode !== 0) console.warn(`! lsregister ${flag} ${target} failed: ${result.stderr.toString().trim()}`)
    else if (flag === "-u") console.log(`Unregistered ${target} from LaunchServices (the folder stays)`)
  }
  console.log(`${identity.scheme}:// links now open ${identity.installedApp}`)
  for (const warning of plan.warnings) console.warn(`! ${warning}`)
}

// `bun scripts/install.ts [--flavor release|dev]`: prints what an install would do now, without doing it.
if (import.meta.main) {
  const identity = appIdentity(flavorArg(process.argv, "dev"))
  const plan = planAfterInstall(identity, new Date())
  console.log(plan.strays.length ? "Would unregister from LaunchServices:" : "No build-folder copies of Cello to unregister.")
  for (const app of plan.strays) console.log(`  ${app}`)
  console.log(`Would register ${identity.installedApp}`)
  for (const warning of plan.warnings) console.log(`! ${warning}`)
}
