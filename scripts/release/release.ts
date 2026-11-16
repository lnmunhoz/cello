// `bun run release` (CEL-36): every deploy is a release. Checks it can release from here, runs the
// typecheck and tests, then hands the rest to release-it (.release-it.json): bump, CHANGELOG.md, commit,
// tag, build (staged in release/stage) and zip, push, GitHub release. Then deploys: cello backup, the staged
// cello goes live, cello service restart. `-- --dry-run` previews all of it without writing anything.
// How it works: docs/releases.md.
//
// The clean-tree check is ours, not release-it's (requireCleanWorkingDir is off in .release-it.json):
// with it on, release-it arms a rollback on process exit that would reset main and delete the tag even
// after our hook pushed them. Instead, when release-it fails, this reads how far it got and prints what
// to undo or finish (recoveryAdvice).
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { PACKAGING_FAILED } from "./artifacts.ts"
import { latestTag, releaseOf, renderSection } from "./changelog.ts"
import { deploy, deployPlanOf, liveBinaryProblem } from "./deploy.ts"
import { parseReleaseArgs, preflightProblems, recoveryAdvice, releaseItArgs, releaseSteps, USAGE } from "./plan.ts"
import { currentVersion, nextVersion, syncVersion } from "./version.ts"

const root = path.join(import.meta.dirname, "../..")

const runGit = (args: string[]) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
  return { code: result.status ?? 1, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() }
}
/** git's output; throws on a non-zero exit, so a failure never reads as an empty answer. */
const git = (...args: string[]): string => {
  const result = runGit(args)
  if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed (exit ${result.code}): ${result.err}`)
  return result.out
}
/** git's output, or null when git failed: for the facts a failure must show as "can't tell". */
const tryGit = (...args: string[]): string | null => {
  const result = runGit(args)
  return result.code === 0 ? result.out : null
}
const run = (cmd: string[], env: Record<string, string> = {}) =>
  spawnSync(cmd[0]!, cmd.slice(1), { cwd: root, stdio: "inherit", env: { ...process.env, ...env } }).status ?? 1
const heading = (text: string) => console.log(`\n== ${text}`)

// Tracked files with uncommitted changes, staged or not (untracked files never reach the release commit);
// null when git diff failed, which isn't a clean tree.
const changedFiles = (): string[] | null => tryGit("diff", "--name-only", "HEAD")?.split("\n").filter(Boolean) ?? null
const tagOnOrigin = (tag: string): boolean | null => {
  const listed = tryGit("ls-remote", "--tags", "origin", `refs/tags/${tag}`)
  return listed === null ? null : listed !== ""
}

// release-it needs a token to create the GitHub release (without one it would open a browser instead).
// Only release-it gets it: its hooks run under `env -u GITHUB_TOKEN` (.release-it.json).
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
    `Cello release: ${current} -> ${next}${options.dryRun ? " (dry run: it fetches origin; nothing is written, committed, tagged, pushed, released or deployed)" : ""}`,
  )

  // Only remote-tracking refs change: what origin/main and the tags are now.
  const fetched = runGit(["fetch", "--quiet", "--tags", "origin"]).code === 0
  const tag = latestTag(root)
  const subject = git("log", "-1", "--format=%s")
  const headOnOrigin = runGit(["merge-base", "--is-ancestor", "HEAD", "origin/main"]).code === 0
  const willDeploy = options.deploy
  const problems = preflightProblems({
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    changedFiles: changedFiles(),
    latestTag: tag,
    version: current,
    increment: options.increment,
    behindOrigin: fetched ? Number(git("rev-list", "--count", "HEAD..origin/main")) : null,
    latestTagOnOrigin: tag === null ? null : tagOnOrigin(tag),
    headIsUnpushedRelease: subject.startsWith("chore(release): v") && fetched && !headOnOrigin,
    liveBinaryProblem: willDeploy ? liveBinaryProblem(deployPlanOf(root)) : null,
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
  const afterChecks = changedFiles()
  if (!options.dryRun && (afterChecks === null || afterChecks.length > 0)) {
    const what = afterChecks === null ? "can't tell whether the checks changed tracked files (git diff failed)" : `the checks changed tracked files (${afterChecks.join(", ")})`
    throw new Error(`Stopped: ${what}. Nothing was released; commit or revert them first.`)
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
    const releaseTag = `v${next}`
    const advice = recoveryAdvice({
      version: next,
      localTag: tryGit("tag", "--list", releaseTag) === releaseTag,
      remoteTag: tagOnOrigin(releaseTag),
      headIsRelease: tryGit("log", "-1", "--format=%s") === `chore(release): ${releaseTag}`,
      changedFiles: changedFiles(),
      packagingFailed: fs.existsSync(path.join(root, PACKAGING_FAILED)),
    })
    throw new Error(
      [`release-it failed (exit ${released}); see its output above. Nothing was deployed: the live cello is untouched.`, ...advice].join("\n"),
    )
  }

  heading("Deploy")
  if (options.dryRun || !options.deploy) {
    console.log(
      `  skipped (${options.dryRun ? "dry run" : "--no-deploy"}): would run cello backup, put release/stage/cello live, then cello service restart`,
    )
    if (!options.dryRun) console.log("  Deploy it later with: bun scripts/release/deploy.ts")
    return
  }
  deploy(deployPlanOf(root))
  console.log(`  v${next} is live.`)
}

try {
  main()
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
