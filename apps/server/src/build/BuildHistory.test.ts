// Build history (CEL-50): a server records the build it starts on, once per build. A restart of the same
// build moves only its last start; a new build lists the commits since the previous recorded one.
import type { ServerBuild } from "@cello/contract/build"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as EventStore from "../events/EventStore.ts"
import builds from "../persistence/migrations/0005_builds.ts"
import { asHuman, services } from "../testing/TestLayers.ts"
import * as BuildHistory from "./BuildHistory.ts"
import { BuildInfo } from "./BuildInfo.ts"

const VERSION = "0.2.0"

/** A server started at `startedAt` on commit `commit`, serving a web build made at `builtAt` that lists `changes`. */
const serverBuild = (commit: string | null, builtAt: number, startedAt: number, changes: ReadonlyArray<string> = []): ServerBuild => ({
  version: VERSION,
  commit,
  startedAt,
  web: { version: VERSION, commit, builtAt, changes },
})

/** What git says is between two commits in the fake history below; null for commits it doesn't have. */
const HISTORY: Record<string, ReadonlyArray<string>> = {
  "aaaaaaa..bbbbbbb": ["merge: build history (CEL-50)", "docs: what a build is"],
  "bbbbbbb..ccccccc": ["merge: needs input (CEL-47)"],
}
const between = (from: string, to: string) => HISTORY[`${from}..${to}`] ?? null

const layer = (changesBetween?: (from: string, to: string) => ReadonlyArray<string> | null) =>
  BuildHistory.layer(changesBetween ? { changesBetween } : {}).pipe(Layer.provideMerge(services()))

const record = (build: ServerBuild) =>
  Effect.flatMap(Effect.service(BuildHistory.BuildHistory), (history) => asHuman(history.record(build)))
const list = (page: { readonly before?: number; readonly limit?: number } = {}) =>
  Effect.flatMap(Effect.service(BuildHistory.BuildHistory), (history) => history.list(page))
const buildEvents = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<{ entity_id: string; workspace_id: string }>`SELECT entity_id, workspace_id FROM events WHERE type = 'build.recorded' ORDER BY seq`
})

describe("recording builds", () => {
  it.effect("records a new build once: its number, version, commit, web build time, start, and the web build's own list of changes for the first one", () =>
    Effect.gen(function* () {
      const recorded = yield* record(serverBuild("aaaaaaa", 1_000, 5_000, ["merge: the reload bar (CEL-37)"]))
      expect(recorded).toEqual({
        id: "0.2.0+aaaaaaa.1000",
        number: 1,
        version: VERSION,
        commit: "aaaaaaa",
        webBuiltAt: 1_000,
        startedAt: 5_000,
        lastStartedAt: 5_000,
        liveUntil: null,
        changes: ["merge: the reload bar (CEL-37)"],
      })
      expect(yield* list()).toEqual({ builds: [recorded], running: recorded!.id, next: null })
    }).pipe(Effect.provide(layer(between))))

  it.effect("writes one build.recorded event per workspace, so every workspace's subscribers hear of it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at) VALUES ('w2', 'Clients', 'clients', 'b0', 1, 1)`
      yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at, archived_at) VALUES ('w3', 'Old', 'old', 'c0', 1, 1, 2)`
      const recorded = yield* record(serverBuild("aaaaaaa", 1_000, 5_000))
      const events = yield* buildEvents
      expect(events.map((e) => e.entity_id)).toEqual([recorded!.id, recorded!.id])
      expect(new Set(events.map((e) => e.workspace_id)).size).toBe(2)
      expect(events.map((e) => e.workspace_id)).not.toContain("w3")
      const [event] = yield* (yield* EventStore.EventStore).history(recorded!.id)
      expect(event).toMatchObject({ type: "build.recorded", build: recorded, projectId: null })
    }).pipe(Effect.provide(layer(between))))

  it.effect("a restart of the same build doesn't add one: it keeps when it went live, moves its last start, and writes no event", () =>
    Effect.gen(function* () {
      const first = yield* record(serverBuild("aaaaaaa", 1_000, 5_000))
      const again = yield* record(serverBuild("aaaaaaa", 1_000, 9_000))
      expect(again).toEqual({ ...first, lastStartedAt: 9_000 })
      expect((yield* list()).builds).toEqual([again])
      expect(yield* buildEvents).toHaveLength(1)
    }).pipe(Effect.provide(layer(between))))

  it.effect("a new build lists the commits since the previous recorded build, as git tells them", () =>
    Effect.gen(function* () {
      yield* record(serverBuild("aaaaaaa", 1_000, 5_000))
      // The web build's own list is since whatever was built in its folder before: git's answer wins.
      const b = yield* record(serverBuild("bbbbbbb", 2_000, 6_000, ["docs: what a build is"]))
      expect(b).toMatchObject({ number: 2, commit: "bbbbbbb", changes: ["merge: build history (CEL-50)", "docs: what a build is"] })
      const c = yield* record(serverBuild("ccccccc", 3_000, 7_000))
      expect(c).toMatchObject({ number: 3, changes: ["merge: needs input (CEL-47)"] })
      expect(yield* buildEvents).toHaveLength(3)
    }).pipe(Effect.provide(layer(between))))

  it.effect("compares with the previous recorded build, not the one before a restart of an older build", () =>
    Effect.gen(function* () {
      yield* record(serverBuild("aaaaaaa", 1_000, 5_000))
      yield* record(serverBuild("bbbbbbb", 2_000, 6_000))
      // Rolled back to A, then deployed C: C's changes are since B, the newest recorded build.
      yield* record(serverBuild("aaaaaaa", 1_000, 6_500))
      expect((yield* record(serverBuild("ccccccc", 3_000, 7_000)))!.changes).toEqual(["merge: needs input (CEL-47)"])
    }).pipe(Effect.provide(layer(between))))

  it.effect("falls back to the web build's own list when git can't tell (no checkout, as in Docker), and has none for a rebuild at the same commit", () =>
    Effect.gen(function* () {
      yield* record(serverBuild("aaaaaaa", 1_000, 5_000))
      expect((yield* record(serverBuild("ddddddd", 2_000, 6_000, ["merge: from build.json (CEL-9)"])))!.changes)
        .toEqual(["merge: from build.json (CEL-9)"])
      expect((yield* record(serverBuild("ddddddd", 2_500, 6_500, ["merge: from build.json (CEL-9)"])))!.changes).toEqual([])
    }).pipe(Effect.provide(layer(between))))

  it.effect("without a way to ask git, every new build takes its web build's list", () =>
    Effect.gen(function* () {
      yield* record(serverBuild("aaaaaaa", 1_000, 5_000))
      expect((yield* record(serverBuild("bbbbbbb", 2_000, 6_000, ["docs: what a build is"])))!.changes).toEqual(["docs: what a build is"])
    }).pipe(Effect.provide(layer())))

  it.effect("records nothing for a server that serves no web app (dev, where Vite serves it), and then nothing runs", () =>
    Effect.gen(function* () {
      expect(yield* record({ version: VERSION, commit: "aaaaaaa", startedAt: 5_000, web: null })).toBeNull()
      expect(yield* list()).toEqual({ builds: [], running: null, next: null })
      expect(yield* buildEvents).toHaveLength(0)
    }).pipe(Effect.provide(layer(between))))

  it.effect("names a build by its web build's commit when the server's own is unknown", () =>
    Effect.gen(function* () {
      const build = serverBuild("aaaaaaa", 1_000, 5_000)
      expect(yield* record({ ...build, commit: null })).toMatchObject({ id: "0.2.0+aaaaaaa.1000", commit: "aaaaaaa" })
    }).pipe(Effect.provide(layer(between))))
})

describe("recording builds safely", () => {
  it.effect("a restart finds the build by its id even when its command receipt is gone (pruned): one row, one event, the last start moves", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const first = yield* record(serverBuild("aaaaaaa", 1_000, 5_000))
      yield* sql`DELETE FROM command_receipts`
      const again = yield* record(serverBuild("aaaaaaa", 1_000, 9_000))
      expect(again).toEqual({ ...first, lastStartedAt: 9_000 })
      expect((yield* list()).builds).toHaveLength(1)
      expect(yield* buildEvents).toHaveLength(1)
    }).pipe(Effect.provide(layer(between))))

  it.effect("asks git only for a new build, before its write: never on a restart of a recorded one", () =>
    Effect.gen(function* () {
      const asked: string[] = []
      const counting = (from: string, to: string) => {
        asked.push(`${from}..${to}`)
        return between(from, to)
      }
      yield* Effect.gen(function* () {
        yield* record(serverBuild("aaaaaaa", 1_000, 5_000))
        yield* record(serverBuild("bbbbbbb", 2_000, 6_000))
        yield* record(serverBuild("bbbbbbb", 2_000, 7_000))
        yield* record(serverBuild("bbbbbbb", 2_000, 8_000))
      }).pipe(Effect.provide(layer(counting)))
      expect(asked).toEqual(["aaaaaaa..bbbbbbb"])
    }))

  it.effect("a failure to record (here, no builds table after a migration mix-up) never stops the server starting: nothing is marked running", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`DROP TABLE builds`
      const started = Layer.build(BuildHistory.recordOnStart).pipe(
        Effect.provideService(BuildInfo, BuildInfo.of({ get: () => Effect.succeed(serverBuild("aaaaaaa", 1_000, 5_000)) })),
      )
      expect((yield* Effect.exit(Effect.scoped(started)))._tag).toBe("Success")
      yield* builds
      expect(yield* list()).toEqual({ builds: [], running: null, next: null })
    }).pipe(Effect.provide(layer(between))))
})

describe("listing builds", () => {
  it.effect("newest first, each live until the next one went live, the running one named, a page at a time", () =>
    Effect.gen(function* () {
      yield* record(serverBuild("aaaaaaa", 1_000, 5_000))
      yield* record(serverBuild("bbbbbbb", 2_000, 6_000))
      const c = yield* record(serverBuild("ccccccc", 3_000, 7_000))
      const all = yield* list()
      expect(all.builds.map((b) => [b.number, b.startedAt, b.liveUntil])).toEqual([[3, 7_000, null], [2, 6_000, 7_000], [1, 5_000, 6_000]])
      expect(all.running).toBe(c!.id)

      const first = yield* list({ limit: 2 })
      expect(first.builds.map((b) => b.number)).toEqual([3, 2])
      expect(first.next).toBe(2)
      const second = yield* list({ limit: 2, before: first.next! })
      expect(second.builds.map((b) => b.number)).toEqual([1])
      expect(second.next).toBeNull()
      expect(second.builds[0]!.liveUntil).toBe(6_000)
    }).pipe(Effect.provide(layer(between))))

  it.effect("refuses a limit that isn't a whole number from 1 to 200", () =>
    Effect.gen(function* () {
      for (const limit of [0, -1, 201, 1.5]) {
        const error = yield* Effect.flip(list({ limit }))
        expect(error).toMatchObject({ _tag: "Invalid", field: "limit" })
      }
      expect((yield* Effect.flip(list({ before: 1.5 })))).toMatchObject({ _tag: "Invalid", field: "before" })
    }).pipe(Effect.provide(layer(between))))
})
