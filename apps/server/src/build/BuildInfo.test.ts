// The server's build: its version and commit, when it started (on the test clock), and the stamp of the
// web app it serves, read from build.json.
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import { APP_VERSION } from "@cello/release/version"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"
import { tempDataDir } from "../testing/tempDir.ts"
import * as WebFiles from "../web/WebFiles.ts"
import * as BuildInfo from "./BuildInfo.ts"

const STAMP = { version: APP_VERSION, commit: "9afd602", builtAt: 1_763_230_000_000, changes: ["merge: the reload bar (CEL-37)"] }

/** A web build folder with index.html and, when given, build.json holding `stamp`. */
const webDir = (dir: string, stamp?: string) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html>")
  if (stamp !== undefined) fs.writeFileSync(path.join(dir, "build.json"), stamp)
  return WebFiles.fromDirectory(dir)
}

describe("the web build the server serves", () => {
  it.effect("is the stamp in build.json beside index.html", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      expect(BuildInfo.readWebBuild(webDir(path.join(dir, "web"), JSON.stringify(STAMP)))).toEqual(STAMP)
    }).pipe(Effect.scoped))

  it.effect("is null without a web app, without build.json (a build from before CEL-37), or when build.json doesn't parse", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      expect(BuildInfo.readWebBuild(undefined)).toBeNull()
      expect(BuildInfo.readWebBuild(webDir(path.join(dir, "old")))).toBeNull()
      expect(BuildInfo.readWebBuild(webDir(path.join(dir, "broken"), "{not json"))).toBeNull()
      expect(BuildInfo.readWebBuild(webDir(path.join(dir, "wrong"), JSON.stringify({ version: 2 })))).toBeNull()
    }).pipe(Effect.scoped))
})

describe("the server's build", () => {
  it.effect("is the app version, the commit, when the server started, and the web build", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const web = webDir(path.join(dir, "web"), JSON.stringify(STAMP))
      yield* TestClock.setTime(1_763_230_740_000)
      const build = yield* Effect.flatMap(Effect.service(BuildInfo.BuildInfo), (info) => info.get()).pipe(
        Effect.provide(BuildInfo.layer({ commit: "9afd602", web })),
      )
      expect(build).toEqual({ version: APP_VERSION, commit: "9afd602", startedAt: 1_763_230_740_000, web: STAMP })
    }).pipe(Effect.scoped))

  it.effect("follows a rebuild of the folder it serves (run from source, the files are read from disk live)", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const folder = path.join(dir, "web")
      const web = webDir(folder, JSON.stringify(STAMP))
      const info = yield* Effect.service(BuildInfo.BuildInfo).pipe(Effect.provide(BuildInfo.layer({ commit: null, web })))
      expect((yield* info.get()).web).toEqual(STAMP)

      // `vite build` rewrites build.json in place; a later mtime marks the new one.
      const rebuilt = { ...STAMP, commit: "bbbbbbb", builtAt: STAMP.builtAt + 60_000 }
      const file = path.join(folder, "build.json")
      fs.writeFileSync(file, JSON.stringify(rebuilt))
      const later = new Date(fs.statSync(file).mtimeMs + 5_000)
      fs.utimesSync(file, later, later)
      expect((yield* info.get()).web).toEqual(rebuilt)

      // Removed (a build in progress): no web stamp until it's back.
      fs.rmSync(file)
      expect((yield* info.get()).web).toBeNull()
    }).pipe(Effect.scoped))
})
