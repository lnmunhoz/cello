// CEL-50: a real server records the build it starts on. Deploying build A, then B, then restarting B
// leaves two builds; B's changes come from the checkout's git history when the server has one, else
// from B's build.json.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import type { WebBuild } from "@cello/contract/build"
import { describe, expect, it } from "@effect/vitest"
import { APP_VERSION } from "@cello/shared/version"
import * as Effect from "effect/Effect"
import * as WebFiles from "../../src/web/WebFiles.ts"
import { startServer, tempDataDir, withClient } from "./harness.ts"

/** A web build folder whose build.json is `stamp`. */
const webBuild = (dir: string, stamp: WebBuild) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Cello</title>")
  fs.writeFileSync(path.join(dir, "build.json"), JSON.stringify(stamp))
  return WebFiles.fromDirectory(dir)
}

const stamp = (commit: string, builtAt: number, changes: ReadonlyArray<string> = []): WebBuild =>
  ({ version: APP_VERSION, commit, builtAt, changes })

/** Starts a server on `dataDir` serving `web` as build `commit`, lists its builds, and stops it. */
const deploy = (dataDir: string, web: WebFiles.WebFiles, commit: string, checkout?: string) =>
  Effect.scoped(Effect.gen(function* () {
    const { port } = yield* startServer(dataDir, { web, commit, ...(checkout ? { checkout } : {}) })
    return yield* withClient(port, (client) => client["builds.list"]({}))
  }))

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

describe("the build history of a real server", () => {
  it.live("records each new build once at start; a restart of the same build adds nothing; the running one is named", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const dataDir = path.join(dir, "data")
      const a = webBuild(path.join(dir, "web-a"), stamp("aaaaaaa", 1_000))
      const b = webBuild(path.join(dir, "web-b"), stamp("bbbbbbb", 2_000, ["merge: build history (CEL-50)"]))

      const first = yield* deploy(dataDir, a, "aaaaaaa")
      expect(first.builds.map((x) => x.commit)).toEqual(["aaaaaaa"])
      expect(first.running).toBe(first.builds[0]!.id)

      const second = yield* deploy(dataDir, b, "bbbbbbb")
      expect(second.builds.map((x) => [x.number, x.commit])).toEqual([[2, "bbbbbbb"], [1, "aaaaaaa"]])
      expect(second.running).toBe(second.builds[0]!.id)
      // No checkout to ask: B's own build.json says what changed.
      expect(second.builds[0]!.changes).toEqual(["merge: build history (CEL-50)"])
      expect(second.builds[1]!.liveUntil).toBe(second.builds[0]!.startedAt)

      const restarted = yield* deploy(dataDir, b, "bbbbbbb")
      expect(restarted.builds).toHaveLength(2)
      expect(restarted.builds[0]!.startedAt).toBe(second.builds[0]!.startedAt)
      expect(restarted.builds[0]!.lastStartedAt).toBeGreaterThanOrEqual(second.builds[0]!.lastStartedAt)
      expect(restarted.running).toBe(second.running)
    }).pipe(Effect.scoped))

  it.live("reads a new build's changes from the checkout's git history, since the previous recorded build", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const repo = path.join(dir, "repo")
      fs.mkdirSync(repo)
      git(repo, "init", "-q", "-b", "main")
      git(repo, "commit", "-q", "--allow-empty", "-m", "init")
      const from = git(repo, "rev-parse", "--short", "HEAD")
      git(repo, "commit", "-q", "--allow-empty", "-m", "merge: needs input (CEL-47)")
      git(repo, "commit", "-q", "--allow-empty", "-m", "merge: build history (CEL-50)")
      const to = git(repo, "rev-parse", "--short", "HEAD")
      const dataDir = path.join(dir, "data")

      yield* deploy(dataDir, webBuild(path.join(dir, "web-a"), stamp(from, 1_000)), from, repo)
      // B's build.json only knows the last merge (something else was built in its folder in between).
      const page = yield* deploy(dataDir, webBuild(path.join(dir, "web-b"), stamp(to, 2_000, ["merge: build history (CEL-50)"])), to, repo)
      expect(page.builds[0]!.changes).toEqual(["merge: build history (CEL-50)", "merge: needs input (CEL-47)"])
    }).pipe(Effect.scoped))

  it.live("a server without a web app (dev) records nothing", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const page = yield* Effect.scoped(Effect.gen(function* () {
        const { port } = yield* startServer(dataDir, { commit: "aaaaaaa" })
        return yield* withClient(port, (client) => client["builds.list"]({}))
      }))
      expect(page).toEqual({ builds: [], running: null, next: null })
    }).pipe(Effect.scoped))
})
