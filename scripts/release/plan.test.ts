// What `bun run release` takes and does, before anything runs: its arguments, the checks that refuse a
// release, the steps a dry run prints, and the release-it arguments it passes on.
import { describe, expect, it } from "vitest"
import { parseReleaseArgs, preflightProblems, recoveryAdvice, releaseItArgs, releaseSteps } from "./plan.ts"

describe("parseReleaseArgs", () => {
  it("defaults to a patch release that deploys, with Cello.app", () => {
    expect(parseReleaseArgs([])).toEqual({ increment: "patch", dryRun: false, deploy: true, desktop: true, help: false })
  })

  it("takes minor, major or a version, and the dry run, no-deploy and skip-desktop flags", () => {
    expect(parseReleaseArgs(["minor", "--dry-run"])).toMatchObject({ increment: "minor", dryRun: true })
    expect(parseReleaseArgs(["-d", "major"])).toMatchObject({ increment: "major", dryRun: true })
    expect(parseReleaseArgs(["0.4.0", "--no-deploy", "--skip-desktop"])).toMatchObject({
      increment: "0.4.0",
      deploy: false,
      desktop: false,
    })
    expect(parseReleaseArgs(["--help"]).help).toBe(true)
  })

  it("refuses flags it doesn't know, and a second increment", () => {
    expect(() => parseReleaseArgs(["--minor"])).toThrow(/Unknown option --minor/)
    expect(() => parseReleaseArgs(["minor", "major"])).toThrow(/one increment/)
  })
})

describe("preflightProblems", () => {
  const ok = { branch: "main", changedFiles: [], latestTag: "v0.3.0", version: "0.3.0" }

  it("finds none on a clean main whose version matches the latest tag", () => {
    expect(preflightProblems(ok)).toEqual([])
    expect(preflightProblems({ ...ok, latestTag: null, version: "0.2.0" })).toEqual([])
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
})

describe("releaseSteps", () => {
  const files = ["package.json", "packages/shared/src/version.ts", "apps/desktop/package.json"]
  const titles = (steps: ReturnType<typeof releaseSteps>) => steps.map((s) => `${s.title} [${s.dryRun}]`)

  it("lists every step in order; a dry run runs only the checks and prints the rest", () => {
    expect(titles(releaseSteps({ increment: "minor", dryRun: true, deploy: true, desktop: true, help: false }, "0.3.0", files))).toEqual([
      "refuse unless on main with a clean tree [runs]",
      "bun run typecheck [runs]",
      "bun run test [runs]",
      "bump to 0.3.0: package.json, packages/shared/src/version.ts, apps/desktop/package.json [skipped]",
      "write the 0.3.0 section of CHANGELOG.md [skipped]",
      "commit chore(release): v0.3.0 [skipped]",
      "tag v0.3.0 [skipped]",
      "build the cello binary and package Cello.app, zipped into release/ [skipped]",
      "push main and v0.3.0 [skipped]",
      "GitHub release v0.3.0 with the changelog section and both zips [skipped]",
      "deploy: cello backup, then cello service restart [skipped]",
    ])
  })

  it("a real release runs every step; --no-deploy and --skip-desktop say what they leave out", () => {
    const steps = releaseSteps({ increment: "patch", dryRun: false, deploy: false, desktop: false, help: false }, "0.3.1", files)
    expect(steps.every((s) => s.title.startsWith("deploy") || s.dryRun === "runs")).toBe(true)
    expect(titles(steps)).toContain("build the cello binary, zipped into release/ (Cello.app skipped: --skip-desktop) [runs]")
    expect(titles(steps)).toContain("GitHub release v0.3.1 with the changelog section and the cello zip [runs]")
    expect(titles(steps).at(-1)).toBe("deploy: cello backup, then cello service restart [skipped]")
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
  const none = { version: "0.3.1", localTag: false, remoteTag: false, headIsRelease: false, changedFiles: [] }

  it("nothing changed: fix it and release again", () => {
    expect(recoveryAdvice(none)).toEqual(["Nothing was changed. Fix the problem above and release again."])
  })

  it("stopped after the bump, before the commit: drop the version and changelog edits", () => {
    expect(recoveryAdvice({ ...none, changedFiles: ["CHANGELOG.md", "package.json"] })).toEqual([
      "Nothing was committed or pushed. Drop the version and changelog edits, fix the problem above, and release again:",
      "  git checkout -- CHANGELOG.md package.json",
    ])
  })

  it("stopped after the commit and tag, before the push: undo both locally", () => {
    expect(recoveryAdvice({ ...none, localTag: true, headIsRelease: true })).toEqual([
      "Nothing was pushed. Undo the release commit and tag, fix the problem above (or add --skip-desktop), and release again:",
      "  git tag -d v0.3.1",
      "  git reset --hard HEAD~1",
    ])
  })

  it("stopped after the push: finish the GitHub release and the deploy by hand", () => {
    expect(recoveryAdvice({ ...none, localTag: true, remoteTag: true, headIsRelease: true })).toEqual([
      "v0.3.1 is pushed: the release commit and tag are on GitHub, so don't undo them. Finish by hand:",
      '  gh release create v0.3.1 release/*.zip --title "Cello v0.3.1" --notes "$(bun scripts/release/changelog.ts notes-of 0.3.1)"',
      "  cello backup && cello service restart",
    ])
  })
})
