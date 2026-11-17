// What `bun run release` takes and does, before anything runs: its arguments, the checks that refuse a
// release, the steps a dry run prints, and the release-it arguments it passes on.
import { describe, expect, it } from "vitest"
import { actionsReport, parseReleaseArgs, preflightProblems, recoveryAdvice, releaseItArgs, releaseSteps } from "./plan.ts"

describe("parseReleaseArgs", () => {
  it("defaults to a patch release that deploys, with the downloads left to GitHub Actions", () => {
    expect(parseReleaseArgs([])).toEqual({
      increment: "patch",
      dryRun: false,
      deploy: true,
      localArtifacts: false,
      desktop: true,
      preid: "beta",
      help: false,
    })
  })

  // CEL-140: preview releases for the app's Preview channel.
  it("takes a pre- increment and --preid for a preview release", () => {
    expect(parseReleaseArgs(["preminor", "--preid", "beta"])).toMatchObject({ increment: "preminor", preid: "beta" })
    expect(parseReleaseArgs(["prerelease", "--preid=rc"])).toMatchObject({ increment: "prerelease", preid: "rc" })
    expect(parseReleaseArgs(["prepatch"])).toMatchObject({ increment: "prepatch", preid: "beta" })
  })

  it("refuses --preid without a pre- increment, or without its id", () => {
    expect(() => parseReleaseArgs(["minor", "--preid", "beta"])).toThrow("--preid names a preview: use it with prepatch, preminor, premajor or prerelease.")
    expect(() => parseReleaseArgs(["preminor", "--preid"])).toThrow("--preid needs an id, like --preid beta.")
  })

  it("takes minor, major or a version, and the dry run, no-deploy, local-artifacts and skip-desktop flags", () => {
    expect(parseReleaseArgs(["minor", "--dry-run"])).toMatchObject({ increment: "minor", dryRun: true })
    expect(parseReleaseArgs(["-d", "major"])).toMatchObject({ increment: "major", dryRun: true })
    expect(parseReleaseArgs(["0.4.0", "--no-deploy", "--local-artifacts", "--skip-desktop"])).toMatchObject({
      increment: "0.4.0",
      deploy: false,
      localArtifacts: true,
      desktop: false,
    })
    expect(parseReleaseArgs(["--local-artifacts"])).toMatchObject({ localArtifacts: true, desktop: true })
    expect(parseReleaseArgs(["--help"]).help).toBe(true)
  })

  it("refuses flags it doesn't know, and a second increment", () => {
    expect(() => parseReleaseArgs(["--minor"])).toThrow(/Unknown option --minor/)
    expect(() => parseReleaseArgs(["minor", "major"])).toThrow(/one increment/)
  })

  it("refuses --skip-desktop without --local-artifacts: the Mac builds no Cello.app then", () => {
    expect(() => parseReleaseArgs(["--skip-desktop"])).toThrow(
      "--skip-desktop only applies with --local-artifacts: without it this Mac builds no Cello.app (GitHub Actions does).",
    )
  })
})

describe("preflightProblems", () => {
  const ok = {
    branch: "main",
    changedFiles: [],
    latestTag: "v0.3.0",
    version: "0.3.0",
    increment: "patch",
    behindOrigin: 0,
    latestTagOnOrigin: true,
    headIsUnpushedRelease: false,
    liveBinaryProblem: null,
  }

  it("finds none on a clean main, up to date with origin, whose version matches the pushed latest tag", () => {
    expect(preflightProblems(ok)).toEqual([])
    expect(preflightProblems({ ...ok, latestTag: null, latestTagOnOrigin: null, version: "0.2.0", increment: "minor" })).toEqual([])
  })

  it("refuses another branch, uncommitted changes, and a version the latest tag disagrees with", () => {
    expect(preflightProblems({ ...ok, branch: "cel-36" })).toEqual(["You're on cel-36: releases are cut from main."])
    expect(preflightProblems({ ...ok, changedFiles: ["AGENTS.md", "package.json"] })).toEqual([
      "The working tree has uncommitted changes (AGENTS.md, package.json): commit or stash them first.",
    ])
    expect(preflightProblems({ ...ok, version: "0.3.1" })).toEqual([
      "package.json says 0.3.1 but the latest tag is v0.3.0: the version files changed outside a release. Put package.json back to 0.3.0 (bun run release writes the version).",
    ])
  })

  it("names at most five changed files", () => {
    const files = ["a", "b", "c", "d", "e", "f", "g"]
    expect(preflightProblems({ ...ok, changedFiles: files })[0]).toContain("(a, b, c, d, e and 2 more)")
  })

  it("refuses when it can't tell what changed: a failing git diff isn't a clean tree", () => {
    expect(preflightProblems({ ...ok, changedFiles: null })).toEqual([
      "Can't tell whether the working tree is clean (git diff failed): check git status, then release again.",
    ])
  })

  it("refuses a main that's behind origin, or one it couldn't fetch", () => {
    expect(preflightProblems({ ...ok, behindOrigin: 2 })).toEqual([
      "main is 2 commits behind origin/main: git pull --ff-only, then release again.",
    ])
    expect(preflightProblems({ ...ok, behindOrigin: 1 })[0]).toContain("1 commit behind")
    expect(preflightProblems({ ...ok, behindOrigin: null })).toEqual([
      "Couldn't fetch origin, so it can't tell whether main is up to date: check the network and your GitHub access, then release again.",
    ])
  })

  it("refuses to release over an earlier release that stopped before its push, with how to undo it", () => {
    expect(preflightProblems({ ...ok, latestTagOnOrigin: false, headIsUnpushedRelease: true })).toEqual([
      "An earlier release stopped before its push: v0.3.0 isn't on origin, HEAD is its unpushed release commit. Undo it, then release again:\n      git tag -d v0.3.0\n      git reset --hard HEAD~1",
    ])
    expect(preflightProblems({ ...ok, latestTagOnOrigin: false })).toEqual([
      "An earlier release stopped before its push: v0.3.0 isn't on origin. Undo it, then release again:\n      git tag -d v0.3.0",
    ])
    expect(preflightProblems({ ...ok, headIsUnpushedRelease: true })).toEqual([
      "An earlier release stopped before its push: HEAD is an unpushed release commit. Undo it, then release again:\n      git reset --hard HEAD~1",
    ])
    expect(preflightProblems({ ...ok, latestTagOnOrigin: null })).toEqual([
      "Can't tell whether v0.3.0 is on origin (git ls-remote failed): check the network and your GitHub access, then release again.",
    ])
  })

  it("refuses a patch as the first release: it's minor (0.2.0 -> 0.3.0) or an exact version", () => {
    expect(preflightProblems({ ...ok, latestTag: null, latestTagOnOrigin: null, version: "0.2.0", increment: "patch" })).toEqual([
      "There's no release tag yet: the first release is bun run release -- minor (0.2.0 -> 0.3.0), or give its version (bun run release -- 0.3.0).",
    ])
    expect(preflightProblems({ ...ok, latestTag: null, latestTagOnOrigin: null, version: "0.2.0", increment: "0.3.0" })).toEqual([])
  })

  it("refuses to deploy when the live cello isn't this checkout's build", () => {
    expect(preflightProblems({ ...ok, liveBinaryProblem: "The cello on your PATH (/x) isn't this checkout's build." })).toEqual([
      "The cello on your PATH (/x) isn't this checkout's build.",
    ])
  })
})

describe("releaseSteps", () => {
  const files = ["package.json", "packages/shared/src/version.ts", "apps/desktop/package.json"]
  const titles = (steps: ReturnType<typeof releaseSteps>) => steps.map((s) => `${s.title} [${s.dryRun}]`)
  const options = { increment: "patch", dryRun: false, deploy: true, localArtifacts: false, desktop: true, preid: "beta", help: false }

  it("lists every step in order; a dry run runs only the checks and prints the rest", () => {
    expect(titles(releaseSteps({ ...options, increment: "minor", dryRun: true }, "0.3.0", files))).toEqual([
      "refuse unless on a clean main, up to date with origin, after a fully pushed release [runs]",
      "bun run typecheck [runs]",
      "bun run test [runs]",
      "bump to 0.3.0: package.json, packages/shared/src/version.ts, apps/desktop/package.json [skipped]",
      "write the 0.3.0 section of CHANGELOG.md [skipped]",
      "commit chore(release): v0.3.0 [skipped]",
      "tag v0.3.0 [skipped]",
      "build this Mac's cello into release/stage (not live yet), for the deploy [skipped]",
      "push main and v0.3.0 [skipped]",
      "GitHub Actions (.github/workflows/release.yml) builds cello and Cello.app for Apple silicon and Intel, then publishes the GitHub release v0.3.0 with the changelog section [skipped]",
      "deploy: cello backup, then the staged cello goes live, then cello service restart [skipped]",
    ])
  })

  it("a real release runs every step; --no-deploy leaves the deploy out", () => {
    const steps = releaseSteps({ ...options, deploy: false }, "0.3.1", files)
    expect(steps.every((s) => s.title.startsWith("deploy") || s.dryRun === "runs")).toBe(true)
    expect(titles(steps).at(-1)).toBe("deploy: cello backup, then the staged cello goes live, then cello service restart [skipped]")
  })

  it("--local-artifacts builds the downloads on this Mac and creates the GitHub release from here", () => {
    const steps = titles(releaseSteps({ ...options, localArtifacts: true }, "0.3.1", files))
    expect(steps).toContain(
      "build the cello binary into release/stage (not live yet) and package Cello.app with it: the cello zip, the DMG and the app zip into release/ [runs]",
    )
    expect(steps).toContain("GitHub release v0.3.1 from this Mac with the changelog section, the cello zip, the DMG and the app zip [runs]")
  })

  it("--local-artifacts --skip-desktop says what it leaves out", () => {
    const steps = titles(releaseSteps({ ...options, localArtifacts: true, desktop: false }, "0.3.1", files))
    expect(steps).toContain("build the cello binary into release/stage (not live yet), zipped into release/ (Cello.app skipped: --skip-desktop) [runs]")
    expect(steps).toContain("GitHub release v0.3.1 from this Mac with the changelog section and the cello zip [runs]")
  })
})

describe("actionsReport", () => {
  const repo = "https://github.com/lnmunhoz/cello"

  it("links the workflow run that builds the release, and the release page it fills", () => {
    expect(actionsReport(repo, "v0.5.0", "https://github.com/lnmunhoz/cello/actions/runs/42")).toEqual([
      "GitHub Actions is building v0.5.0's downloads: https://github.com/lnmunhoz/cello/actions/runs/42",
      "When it's done, they're on https://github.com/lnmunhoz/cello/releases/tag/v0.5.0",
    ])
  })

  it("links the workflow's page when the run isn't listed yet", () => {
    expect(actionsReport(repo, "v0.5.0", null)[0]).toBe(
      "GitHub Actions builds v0.5.0's downloads in the Release workflow (its run shows here within a minute): https://github.com/lnmunhoz/cello/actions/workflows/release.yml",
    )
  })
})

describe("releaseItArgs", () => {
  it("passes the exact version, non-interactive and verbose (hook output shows)", () => {
    expect(releaseItArgs({ dryRun: false }, "0.3.1")).toEqual(["0.3.1", "--ci", "--verbose"])
  })

  it("a dry run relaxes release-it's own branch and upstream checks: the preflight already reported them", () => {
    expect(releaseItArgs({ dryRun: true }, "0.3.0")).toEqual([
      "0.3.0",
      "--ci",
      "--verbose",
      "--dry-run",
      "--no-git.requireBranch",
      "--no-git.requireUpstream",
    ])
  })
})

describe("recoveryAdvice", () => {
  const none = {
    version: "0.3.1",
    localTag: false,
    remoteTag: false,
    headIsRelease: false,
    changedFiles: [],
    packagingFailed: false,
    localArtifacts: false,
  }

  it("nothing changed: fix it and release again", () => {
    expect(recoveryAdvice(none)).toEqual(["Nothing was changed. Fix the problem above and release again."])
  })

  it("stopped after the bump, before the commit: drop the version and changelog edits", () => {
    expect(recoveryAdvice({ ...none, changedFiles: ["CHANGELOG.md", "package.json"] })).toEqual([
      "Nothing was committed or pushed. Drop the version and changelog edits, fix the problem above, and release again:",
      "  git checkout -- CHANGELOG.md package.json",
    ])
  })

  it("stopped after the commit and tag, before the push: undo both locally, and delete release/ so its build can't be deployed", () => {
    expect(recoveryAdvice({ ...none, localTag: true, headIsRelease: true })).toEqual([
      "Nothing was pushed. Undo the release commit and tag, fix the problem above, and release again:",
      "  git tag -d v0.3.1",
      "  git reset --hard HEAD~1",
      "  rm -rf release",
    ])
  })

  it("offers --skip-desktop only when packaging Cello.app was what failed", () => {
    expect(recoveryAdvice({ ...none, localTag: true, headIsRelease: true, packagingFailed: true })[0]).toBe(
      "Nothing was pushed. Undo the release commit and tag, fix the problem above (or add --skip-desktop), and release again:",
    )
  })

  it("never says nothing was pushed when it can't tell", () => {
    expect(recoveryAdvice({ ...none, localTag: true, headIsRelease: true, remoteTag: null })).toEqual([
      "Can't tell whether v0.3.1 was pushed (git ls-remote --tags origin failed). Don't reset or delete anything until `git ls-remote --tags origin refs/tags/v0.3.1` works. If it lists the tag, GitHub Actions builds and publishes its release; deploy by hand:",
      "  bun scripts/release/deploy.ts",
      "If it doesn't, undo the release here and release again:",
      "  git tag -d v0.3.1",
      "  git reset --hard HEAD~1",
      "  rm -rf release",
    ])
    expect(recoveryAdvice({ ...none, changedFiles: null })).toEqual([
      "Can't tell what changed (git diff failed): check git status before releasing again.",
    ])
  })

  it("stopped after the push: GitHub Actions publishes the release, so only the deploy is left", () => {
    expect(recoveryAdvice({ ...none, localTag: true, remoteTag: true, headIsRelease: true })).toEqual([
      "v0.3.1 is pushed: the release commit and tag are on GitHub, so don't undo them. GitHub Actions builds and publishes its release; deploy by hand:",
      "  bun scripts/release/deploy.ts",
    ])
  })

  it("stopped after the push with --local-artifacts: publish the GitHub release from here, then deploy", () => {
    expect(recoveryAdvice({ ...none, localTag: true, remoteTag: true, headIsRelease: true, localArtifacts: true })).toEqual([
      "v0.3.1 is pushed: the release commit and tag are on GitHub, so don't undo them. Finish by hand:",
      "  bun scripts/release/publish.ts 0.3.1",
      "  bun scripts/release/deploy.ts",
    ])
  })
})
