// `cello builds` against a real server (CEL-50): after deploying build A, then B, it lists both, newest
// first, the running one marked, with B's changes; --json and paging with --before.
import * as fs from "node:fs"
import * as path from "node:path"
import type { BuildPage } from "@cello/contract/build"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import * as WebFiles from "@cello/server/web/WebFiles"
import { APP_VERSION } from "@cello/release/version"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { cello } from "./cli.ts"

const webBuild = (dir: string, commit: string, builtAt: number, changes: ReadonlyArray<string>) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html>")
  fs.writeFileSync(path.join(dir, "build.json"), JSON.stringify({ version: APP_VERSION, commit, builtAt, changes }))
  return WebFiles.fromDirectory(dir)
}

describe("cello builds", () => {
  it.live("lists the builds the server has run, newest first, the running one marked, with what changed", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const dataDir = path.join(dir, "data")
      yield* Effect.scoped(startServer(dataDir, { web: webBuild(path.join(dir, "a"), "aaaaaaa", 1_000, []), commit: "aaaaaaa" }))
      const { port } = yield* startServer(dataDir, {
        web: webBuild(path.join(dir, "b"), "bbbbbbb", 2_000, ["merge: build history (CEL-50)"]),
        commit: "bbbbbbb",
      })
      const run = cello({ port, cwd: dir, env: { CELLO_DATA_DIR: dataDir } })

      const text = (yield* run("builds")).out.split("\n")
      expect(text[0]).toMatch(new RegExp(`^#2  build bbbbbbb  Cello ${APP_VERSION.replaceAll(".", "\\.")}  live since \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d, for under a minute  running$`))
      expect(text[1]).toBe("    merge: build history (CEL-50)")
      expect(text[2]).toMatch(/^#1  build aaaaaaa  /)
      expect(text[2]).not.toContain("running")
      expect(text[3]).toBe("    no changes since the build before it")

      const page = JSON.parse((yield* run("builds", "--json")).out) as BuildPage
      expect(page.builds.map((b) => b.commit)).toEqual(["bbbbbbb", "aaaaaaa"])
      expect(page.running).toBe(page.builds[0]!.id)

      const first = (yield* run("builds", "--limit", "1")).out.split("\n")
      expect(first.at(-1)).toBe("Older builds: cello builds --before 2")
      expect((yield* run("builds", "--before", "2")).out.split("\n")[0]).toMatch(/^#1  build aaaaaaa/)
      expect((yield* run("builds", "--limit", "500")).failure).toContain("limit")
    }).pipe(Effect.scoped))
})
