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

  patch            the default: 0.3.0 -> 0.3.1
  minor | major    when Lucas asks: 0.3.1 -> 0.4.0 | 1.0.0
  --dry-run, -d    run the checks, typecheck and tests, print the plan, the changelog section and
                   release-it's commands; write, commit, tag, push, release and deploy nothing
  --no-deploy      release, but don't back up and restart the live server
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
  /** Tracked files with uncommitted changes (`git diff --name-only HEAD`). */
  readonly changedFiles: ReadonlyArray<string>
  readonly latestTag: string | null
  /** The root package.json's version. */
  readonly version: string
}

/** Why a release can't be cut from here; empty when it can. */
export const preflightProblems = (state: RepoState): string[] => {
  const problems: string[] = []
  if (state.branch !== "main") problems.push(`You're on ${state.branch}: releases are cut from main.`)
  if (state.changedFiles.length > 0) {
    const shown = state.changedFiles.slice(0, 5).join(", ")
    const more = state.changedFiles.length > 5 ? ` and ${state.changedFiles.length - 5} more` : ""
    problems.push(`The working tree has uncommitted changes (${shown}${more}): commit or stash them first.`)
  }
  if (state.latestTag && state.latestTag !== `v${state.version}`) {
    problems.push(
      `package.json says ${state.version} but the latest tag is ${state.latestTag}: the version files changed outside a release. Put package.json back to ${state.latestTag.slice(1)} (bun run release writes the version).`,
    )
  }
  return problems
}

export type Step = { readonly title: string; readonly dryRun: "runs" | "skipped" }

/** Every step of the release, in order, and whether it runs in this run. */
export const releaseSteps = (options: ReleaseOptions, next: string, versionFiles: ReadonlyArray<string>): Step[] => {
  const tag = `v${next}`
  const write = options.dryRun ? "skipped" : "runs"
  const build = options.desktop
    ? "build the cello binary and package Cello.app, zipped into release/"
    : "build the cello binary, zipped into release/ (Cello.app skipped: --skip-desktop)"
  return [
    { title: "refuse unless on main with a clean tree", dryRun: "runs" },
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
    { title: "deploy: cello backup, then cello service restart", dryRun: options.dryRun || !options.deploy ? "skipped" : "runs" },
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
  /** Whether v<version> exists here, and on origin. */
  readonly localTag: boolean
  readonly remoteTag: boolean
  /** Whether HEAD is the release commit (chore(release): v<version>). */
  readonly headIsRelease: boolean
  /** Tracked files with uncommitted changes. */
  readonly changedFiles: ReadonlyArray<string>
}

/** What to do after release-it failed, from how far it got. release-it's own rollback is off (.release-it.json). */
export const recoveryAdvice = (state: FailedRelease): string[] => {
  const tag = `v${state.version}`
  if (state.remoteTag) {
    return [
      `${tag} is pushed: the release commit and tag are on GitHub, so don't undo them. Finish by hand:`,
      `  gh release create ${tag} release/*.zip --title "Cello ${tag}" --notes "$(bun scripts/release/changelog.ts notes-of ${state.version})"`,
      "  cello backup && cello service restart",
    ]
  }
  if (state.localTag || state.headIsRelease) {
    return [
      "Nothing was pushed. Undo the release commit and tag, fix the problem above (or add --skip-desktop), and release again:",
      ...(state.localTag ? [`  git tag -d ${tag}`] : []),
      ...(state.headIsRelease ? ["  git reset --hard HEAD~1"] : []),
    ]
  }
  if (state.changedFiles.length > 0) {
    return [
      "Nothing was committed or pushed. Drop the version and changelog edits, fix the problem above, and release again:",
      `  git checkout -- ${state.changedFiles.join(" ")}`,
    ]
  }
  return ["Nothing was changed. Fix the problem above and release again."]
}
