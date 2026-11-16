// What `bun run release` takes and plans (CEL-36): its arguments, the checks that refuse a release, the
// steps it prints (and which a dry run skips), and the arguments it hands to release-it.

export type ReleaseOptions = {
  /** patch (the default), minor, major, or an exact version. */
  readonly increment: string
  readonly dryRun: boolean
  readonly deploy: boolean
  readonly desktop: boolean
  readonly help: boolean
}

export const USAGE = `Usage: bun run release [-- [patch|minor|major|<x.y.z>] [--dry-run] [--no-deploy] [--skip-desktop]]

  patch            the default: 0.3.0 -> 0.3.1 (the first release is minor or an exact version)
  minor | major    when Lucas asks: 0.3.1 -> 0.4.0 | 1.0.0
  --dry-run, -d    run the checks, typecheck and tests, print the plan, the changelog section and
                   release-it's commands; write, commit, tag, push, release and deploy nothing
  --no-deploy      release, but leave the live cello and server alone; the build waits in
                   release/stage/cello until bun scripts/release/deploy.ts
  --skip-desktop   release without Cello.app (when packaging it can't work here)

How releases work: docs/releases.md`

export const parseReleaseArgs = (argv: ReadonlyArray<string>): ReleaseOptions => {
  let increment: string | null = null
  let dryRun = false
  let deploy = true
  let desktop = true
  let help = false
  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "-d") dryRun = true
    else if (arg === "--no-deploy") deploy = false
    else if (arg === "--skip-desktop") desktop = false
    else if (arg === "--help" || arg === "-h") help = true
    else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}.\n\n${USAGE}`)
    else if (increment !== null) throw new Error(`Give one increment (patch, minor, major or a version), not "${increment}" and "${arg}".`)
    else increment = arg
  }
  return { increment: increment ?? "patch", dryRun, deploy, desktop, help }
}

export type RepoState = {
  readonly branch: string
  /** Tracked files with uncommitted changes (`git diff --name-only HEAD`); null when git failed. */
  readonly changedFiles: ReadonlyArray<string> | null
  readonly latestTag: string | null
  /** The root package.json's version. */
  readonly version: string
  /** What the release asks for: patch, minor, major or a version. */
  readonly increment: string
  /** Commits on origin/main that HEAD lacks, after a fetch; null when the fetch failed. */
  readonly behindOrigin: number | null
  /** Whether the latest tag is on origin; null when there's no tag or git ls-remote failed. */
  readonly latestTagOnOrigin: boolean | null
  /** HEAD is a `chore(release): v…` commit that origin/main doesn't have: a release stopped before its push. */
  readonly headIsUnpushedRelease: boolean
  /** Why deploying wouldn't put this build live (deploy.ts liveBinaryProblem); null when fine or not deploying. */
  readonly liveBinaryProblem: string | null
}

/** Why a release can't be cut from here; empty when it can. */
export const preflightProblems = (state: RepoState): string[] => {
  const problems: string[] = []
  const network = "check the network and your GitHub access, then release again."
  if (state.branch !== "main") problems.push(`You're on ${state.branch}: releases are cut from main.`)
  if (state.changedFiles === null) {
    problems.push("Can't tell whether the working tree is clean (git diff failed): check git status, then release again.")
  } else if (state.changedFiles.length > 0) {
    const shown = state.changedFiles.slice(0, 5).join(", ")
    const more = state.changedFiles.length > 5 ? ` and ${state.changedFiles.length - 5} more` : ""
    problems.push(`The working tree has uncommitted changes (${shown}${more}): commit or stash them first.`)
  }
  if (state.behindOrigin === null) problems.push(`Couldn't fetch origin, so it can't tell whether main is up to date: ${network}`)
  else if (state.behindOrigin > 0) {
    const commits = state.behindOrigin === 1 ? "1 commit" : `${state.behindOrigin} commits`
    problems.push(`main is ${commits} behind origin/main: git pull --ff-only, then release again.`)
  }
  const tagMissing = state.latestTag !== null && state.latestTagOnOrigin === false
  if (state.latestTag !== null && state.latestTagOnOrigin === null) {
    problems.push(`Can't tell whether ${state.latestTag} is on origin (git ls-remote failed): ${network}`)
  }
  if (tagMissing || state.headIsUnpushedRelease) {
    const what = [
      ...(tagMissing ? [`${state.latestTag} isn't on origin`] : []),
      ...(state.headIsUnpushedRelease ? [tagMissing ? "HEAD is its unpushed release commit" : "HEAD is an unpushed release commit"] : []),
    ].join(", ")
    const undo = [
      ...(tagMissing ? [`git tag -d ${state.latestTag}`] : []),
      ...(state.headIsUnpushedRelease ? ["git reset --hard HEAD~1"] : []),
    ]
    problems.push(
      `An earlier release stopped before its push: ${what}. Undo it, then release again:${undo.map((u) => `\n      ${u}`).join("")}`,
    )
  }
  if (state.latestTag && state.latestTag !== `v${state.version}`) {
    problems.push(
      `package.json says ${state.version} but the latest tag is ${state.latestTag}: the version files changed outside a release. Put package.json back to ${state.latestTag.slice(1)} (bun run release writes the version).`,
    )
  }
  if (state.latestTag === null && state.increment === "patch") {
    const first = nextMinor(state.version)
    problems.push(
      `There's no release tag yet: the first release is bun run release -- minor (${state.version} -> ${first}), or give its version (bun run release -- ${first}).`,
    )
  }
  if (state.liveBinaryProblem) problems.push(state.liveBinaryProblem)
  return problems
}

const nextMinor = (version: string) => {
  const [major, minor] = version.split(".").map(Number)
  return `${major}.${(minor ?? 0) + 1}.0`
}

export type Step = { readonly title: string; readonly dryRun: "runs" | "skipped" }

/** Every step of the release, in order, and whether it runs in this run. */
export const releaseSteps = (options: ReleaseOptions, next: string, versionFiles: ReadonlyArray<string>): Step[] => {
  const tag = `v${next}`
  const write = options.dryRun ? "skipped" : "runs"
  const build = options.desktop
    ? "build the cello binary into release/stage (not live yet) and package Cello.app with it, zipped into release/"
    : "build the cello binary into release/stage (not live yet), zipped into release/ (Cello.app skipped: --skip-desktop)"
  return [
    { title: "refuse unless on a clean main, up to date with origin, after a fully pushed release", dryRun: "runs" },
    { title: "bun run typecheck", dryRun: "runs" },
    { title: "bun run test", dryRun: "runs" },
    { title: `bump to ${next}: ${versionFiles.join(", ")}`, dryRun: write },
    { title: `write the ${next} section of CHANGELOG.md`, dryRun: write },
    { title: `commit chore(release): ${tag}`, dryRun: write },
    { title: `tag ${tag}`, dryRun: write },
    { title: build, dryRun: write },
    { title: `push main and ${tag}`, dryRun: write },
    {
      title: `GitHub release ${tag} with the changelog section and ${options.desktop ? "both zips" : "the cello zip"}`,
      dryRun: write,
    },
    { title: "deploy: cello backup, then the staged cello goes live, then cello service restart", dryRun: options.dryRun || !options.deploy ? "skipped" : "runs" },
  ]
}

/**
 * release-it's arguments: the exact version (computed from package.json, so release-it never guesses one),
 * no prompts, hook output shown. A dry run also relaxes release-it's own branch and upstream checks, so it
 * can preview from anywhere: the preflight has already said what a real run would refuse.
 */
export const releaseItArgs = (options: Pick<ReleaseOptions, "dryRun">, next: string): string[] => [
  next,
  "--ci",
  "--verbose",
  ...(options.dryRun ? ["--dry-run", "--no-git.requireBranch", "--no-git.requireUpstream"] : []),
]

export type FailedRelease = {
  readonly version: string
  /** Whether v<version> exists here. */
  readonly localTag: boolean
  /** Whether it's on origin; null when git ls-remote failed, so nobody can tell. */
  readonly remoteTag: boolean | null
  /** Whether HEAD is the release commit (chore(release): v<version>). */
  readonly headIsRelease: boolean
  /** Tracked files with uncommitted changes; null when git diff failed. */
  readonly changedFiles: ReadonlyArray<string> | null
}

/**
 * What to do after release-it failed, from how far it got. release-it's own rollback is off
 * (.release-it.json). It never says nothing was pushed when it can't tell.
 */
export const recoveryAdvice = (state: FailedRelease): string[] => {
  const tag = `v${state.version}`
  const finish = [
    `  gh release create ${tag} release/*.zip --title "Cello ${tag}" --notes "$(bun scripts/release/changelog.ts notes-of ${state.version})"`,
    "  bun scripts/release/deploy.ts",
  ]
  const undo = [...(state.localTag ? [`  git tag -d ${tag}`] : []), ...(state.headIsRelease ? ["  git reset --hard HEAD~1"] : [])]
  const madeSomething = state.localTag || state.headIsRelease
  if (state.remoteTag === true) {
    return [`${tag} is pushed: the release commit and tag are on GitHub, so don't undo them. Finish by hand:`, ...finish]
  }
  if (state.remoteTag === null && madeSomething) {
    return [
      `Can't tell whether ${tag} was pushed (git ls-remote --tags origin failed). Don't reset or delete anything until \`git ls-remote --tags origin refs/tags/${tag}\` works. If it lists the tag, finish by hand:`,
      ...finish,
      "If it doesn't, undo the release here and release again:",
      ...undo,
    ]
  }
  if (madeSomething) {
    return ["Nothing was pushed. Undo the release commit and tag, fix the problem above (or add --skip-desktop), and release again:", ...undo]
  }
  if (state.changedFiles === null) return ["Can't tell what changed (git diff failed): check git status before releasing again."]
  if (state.changedFiles.length > 0) {
    return [
      "Nothing was committed or pushed. Drop the version and changelog edits, fix the problem above, and release again:",
      `  git checkout -- ${state.changedFiles.join(" ")}`,
    ]
  }
  return ["Nothing was changed. Fix the problem above and release again."]
}
