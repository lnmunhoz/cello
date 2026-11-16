// `bun run release` (CEL-36): every deploy is a release. Checks it can release from here, runs the
// typecheck and tests, then hands the rest to release-it (.release-it.json): bump, CHANGELOG.md, commit,
// tag, build and zip, push, GitHub release. Then deploys: cello backup, cello service restart.
// `-- --dry-run` previews all of it without writing anything. How it works: docs/releases.md.
//
// The clean-tree check is ours, not release-it's (requireCleanWorkingDir is off in .release-it.json):
// with it on, release-it arms a rollback on process exit that would reset main and delete the tag even
// after our hook pushed them. Instead, when release-it fails, this reads how far it got and prints what
// to undo or finish (recoveryAdvice).
import { spawnSync } from "node:child_process"
import * as path from "node:path"
import { latestTag, releaseOf, renderSection } from "./changelog.ts"
import { binariesOf, deploy } from "./deploy.ts"
import { parseReleaseArgs, preflightProblems, recoveryAdvice, releaseItArgs, releaseSteps, USAGE } from "./plan.ts"
import { currentVersion, nextVersion, syncVersion } from "./version.ts"

const root = path.join(import.meta.dirname, "../..")

const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout.trim()
const run = (cmd: string[], env: Record<string, string> = {}) =>
  spawnSync(cmd[0]!, cmd.slice(1), { cwd: root, stdio: "inherit", env: { ...process.env, ...env } }).status ?? 1
const heading = (text: string) => console.log(`\n== ${text}`)
// Tracked files with uncommitted changes, staged or not (untracked files never reach the release commit).
const changedFiles = () => git("diff", "--name-only", "HEAD").split("\n").filter(Boolean)

// release-it needs a token to create the GitHub release (without one it would open a browser instead).
const githubToken = (): string | null => {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8" })
  return gh.status === 0 && gh.stdout.trim() ? gh.stdout.trim() : null
}

const main = () => {
  const options = parseReleaseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }
  const current = currentVersion(root)
  const next = nextVersion(current, options.increment)
  console.log(
    `Cello release: ${current} -> ${next}${options.dryRun ? " (dry run: nothing is written, committed, tagged, pushed, released or deployed)" : ""}`,
  )

  const problems = preflightProblems({
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    changedFiles: changedFiles(),
    latestTag: latestTag(root),
    version: current,
  })
  if (problems.length > 0) {
    console.log(options.dryRun ? "\nA real release would refuse:" : "\nCan't release:")
    for (const problem of problems) console.log(`  - ${problem}`)
    if (!options.dryRun) process.exit(1)
  }

  heading("Steps")
  releaseSteps(options, next, syncVersion(root, next, { dryRun: true })).forEach((step, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. ${step.title}${step.dryRun === "skipped" ? "  (skipped)" : ""}`),
  )

  for (const check of [["bun", "run", "typecheck"], ["bun", "run", "test"]]) {
    heading(check.join(" "))
    const code = run(check)
    if (code !== 0) throw new Error(`${check.join(" ")} failed (exit ${code}): nothing was released.`)
  }

  // The tests mustn't have changed a tracked file: release-it's commit takes every tracked change.
  if (!options.dryRun && changedFiles().length > 0) {
    throw new Error(`The checks changed tracked files (${changedFiles().join(", ")}): nothing was released. Commit or revert them first.`)
  }

  if (options.dryRun) {
    heading(`CHANGELOG.md: the ${next} section a release would add`)
    console.log(renderSection(releaseOf(root, next)))
  }

  const token = githubToken()
  if (!token && !options.dryRun) throw new Error("No GitHub token: log in with gh auth login (or set GITHUB_TOKEN), then release again.")

  heading(`release-it ${releaseItArgs(options, next).join(" ")}`)
  const released = run([path.join(root, "node_modules/.bin/release-it"), ...releaseItArgs(options, next)], {
    GITHUB_TOKEN: token ?? "dry-run-has-no-token",
    ...(options.desktop ? {} : { CELLO_RELEASE_SKIP_DESKTOP: "1" }),
  })
  if (released !== 0) {
    if (options.dryRun) throw new Error(`release-it's dry run failed (exit ${released}); see its output above.`)
    const tag = `v${next}`
    const advice = recoveryAdvice({
      version: next,
      localTag: git("tag", "--list", tag) === tag,
      remoteTag: git("ls-remote", "--tags", "origin", `refs/tags/${tag}`) !== "",
      headIsRelease: git("log", "-1", "--format=%s") === `chore(release): ${tag}`,
      changedFiles: changedFiles(),
    })
    throw new Error([`release-it failed (exit ${released}); see its output above. Nothing was deployed.`, ...advice].join("\n"))
  }

  heading("Deploy")
  if (options.dryRun || !options.deploy) {
    console.log(`  skipped (${options.dryRun ? "dry run" : "--no-deploy"}): would run cello backup, then cello service restart`)
    return
  }
  deploy(binariesOf(root))
  console.log(`  v${next} is live.`)
}

try {
  main()
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
