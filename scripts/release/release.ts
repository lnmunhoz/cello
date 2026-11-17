// `bun run release` (CEL-36): every deploy is a release. Checks it can release from here, runs the
// typecheck and tests, then hands the rest to release-it (.release-it.json): bump, CHANGELOG.md, commit,
// tag, this Mac's own cello (staged in release/stage), push. The pushed tag starts GitHub Actions
// (.github/workflows/release.yml, CEL-139), which builds the downloads for Apple silicon and Intel and
// publishes the GitHub release; this prints the run's link. Then deploys: cello backup, the staged cello
// goes live, cello service restart. `-- --local-artifacts` builds the downloads and creates the GitHub release
// on this Mac instead. `-- --dry-run` previews all of it without writing anything. How it works: docs/releases.md.
//
// The clean-tree check is ours, not release-it's (requireCleanWorkingDir is off in .release-it.json):
// with it on, release-it arms a rollback on process exit that would reset main and delete the tag even
// after our hook pushed them. Instead, when release-it fails, this reads how far it got and prints what
// to undo or finish (recoveryAdvice).
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { PACKAGING_FAILED } from "./artifacts.ts"
import { latestTag, originUrl, releaseOf, renderSection } from "./changelog.ts"
import { deploy, deployPlanOf, liveBinaryProblem } from "./deploy.ts"
import {
  actionsReport,
  parseReleaseArgs,
  preflightProblems,
  RELEASE_WORKFLOW,
  recoveryAdvice,
  releaseItArgs,
  releaseSteps,
  USAGE,
} from "./plan.ts"
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

// --local-artifacts creates the GitHub release from here with gh (publish.ts), so gh must be logged in.
const ghCanPublish = (): boolean =>
  Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN) || spawnSync("gh", ["auth", "token"], { stdio: "ignore" }).status === 0

// The workflow run the pushed tag started, if GitHub lists it yet: one look, no waiting.
const workflowRun = (tag: string): string | null => {
  const workflow = path.basename(RELEASE_WORKFLOW)
  const listed = spawnSync("gh", ["run", "list", "--workflow", workflow, "--branch", tag, "--limit", "1", "--json", "url", "--jq", ".[0].url // \"\""], {
    cwd: root,
    encoding: "utf8",
  })
  return listed.status === 0 && listed.stdout.trim() ? listed.stdout.trim() : null
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

  if (options.localArtifacts && !options.dryRun && !ghCanPublish()) {
    throw new Error("--local-artifacts creates the GitHub release with gh, which isn't logged in: gh auth login, then release again.")
  }

  heading(`release-it ${releaseItArgs(options, next).join(" ")}`)
  const released = run([path.join(root, "node_modules/.bin/release-it"), ...releaseItArgs(options, next)], {
    ...(options.localArtifacts ? { CELLO_RELEASE_LOCAL_ARTIFACTS: "1" } : {}),
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
      localArtifacts: options.localArtifacts,
    })
    throw new Error(
      [`release-it failed (exit ${released}); see its output above. Nothing was deployed: the live cello is untouched.`, ...advice].join("\n"),
    )
  }

  if (!options.dryRun && !options.localArtifacts) {
    heading("GitHub Actions")
    const tag = `v${next}`
    for (const line of actionsReport(originUrl(root), tag, workflowRun(tag))) console.log(`  ${line}`)
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
