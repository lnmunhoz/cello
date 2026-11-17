// .release-it.json: the parts the release relies on, so an edit can't quietly undo them.
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const config = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../../.release-it.json"), "utf8"))

describe(".release-it.json", () => {
  it("leaves release-it's rollback off, and the push to our hook, after the build", () => {
    expect(config.git.requireCleanWorkingDir).toBe(false) // with it on, a rollback on exit would undo a pushed tag
    expect(config.git.push).toBe(false)
    // after:release runs once the commit and tag exist (git.push off means after:git:release never runs).
    expect(config.hooks["after:release"]).toEqual([
      "bun scripts/release/hooks.ts build ${version}",
      "git push --atomic origin refs/heads/main refs/tags/v${version}",
      "bun scripts/release/hooks.ts publish ${version}",
    ])
  })

  it("never creates the GitHub release itself: GitHub Actions does, or publish.ts with --local-artifacts (CEL-139)", () => {
    expect(config.github).toEqual({ release: false })
    expect(config.hooks["before:github:release"]).toBeUndefined() // never runs with the GitHub plugin off
  })
})
