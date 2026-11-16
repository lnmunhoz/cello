// .release-it.json: the parts the release relies on, so an edit can't quietly undo them.
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const config = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../../.release-it.json"), "utf8"))
const hooks: string[] = Object.values(config.hooks as Record<string, string | string[]>).flat()

describe(".release-it.json", () => {
  it("keeps the GitHub token from every command it runs: only release-it's GitHub step uses it", () => {
    for (const command of [...hooks, config.git.changelog]) expect(command).toMatch(/^env -u GITHUB_TOKEN /)
  })

  it("leaves release-it's rollback off, and the push to our hook, after the build", () => {
    expect(config.git.requireCleanWorkingDir).toBe(false) // with it on, a rollback on exit would undo a pushed tag
    expect(config.git.push).toBe(false)
    expect(config.hooks["before:github:release"]).toEqual([
      "env -u GITHUB_TOKEN bun scripts/release/hooks.ts artifacts ${version}",
      "env -u GITHUB_TOKEN git push --atomic origin refs/heads/main refs/tags/v${version}",
    ])
  })

  it("attaches only release/'s zips, never the staged binary", () => {
    expect(config.github.assets).toEqual(["release/*.zip"])
  })
})
