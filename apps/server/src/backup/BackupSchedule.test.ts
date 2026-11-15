// The daily backup, on the test clock: one at start when the newest auto backup is 24 h old (or there
// is none), then every 24 h. Manual backups don't postpone it. A failure is logged, never fatal, and
// tried again an hour later.
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as TestClock from "effect/testing/TestClock"
import * as AssetStore from "../review/AssetStore.ts"
import { database } from "../testing/TestLayers.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import * as BackupSchedule from "./BackupSchedule.ts"
import * as BackupService from "./BackupService.ts"

const dataFolder = Layer.unwrap(Effect.map(tempDataDir, (dir) =>
  BackupService.layer({ dir: path.join(dir, "backups") }).pipe(
    Layer.provideMerge(Layer.succeed(AssetStore.AssetStore, AssetStore.make({ dir: path.join(dir, "assets"), ffmpeg: null }))),
    Layer.provideMerge(database()),
  )))

/** Starts the schedule; every check it makes arrives on the returned queue. */
const startSchedule = Effect.gen(function* () {
  const checks = yield* Queue.unbounded<BackupSchedule.Check>()
  yield* Effect.forkScoped(BackupSchedule.run({ onCheck: (check) => Queue.offer(checks, check) }))
  return checks
})

const autoBackups = Effect.map(Effect.flatMap(Effect.service(BackupService.BackupService), (s) => s.list()), (all) => all.filter((b) => b.kind === "auto"))

describe("BackupSchedule", () => {
  it.effect("takes one at start when there's none, then one every 24 hours", () =>
    Effect.gen(function* () {
      const checks = yield* startSchedule
      expect((yield* Queue.take(checks))._tag).toBe("Taken")
      expect(yield* autoBackups).toHaveLength(1)

      yield* TestClock.adjust("23 hours")
      expect(yield* Queue.size(checks)).toBe(0)
      yield* TestClock.adjust("1 hour")
      expect((yield* Queue.take(checks))._tag).toBe("Taken")
      yield* TestClock.adjust("24 hours")
      expect((yield* Queue.take(checks))._tag).toBe("Taken")
      expect((yield* autoBackups).map((b) => b.createdAt)).toEqual([2 * 86_400_000, 86_400_000, 0])
    }).pipe(Effect.scoped, Effect.provide(dataFolder)))

  it.effect("a recent auto backup postpones the first one until it is 24 hours old; manual and safety ones don't count", () =>
    Effect.gen(function* () {
      const backups = yield* BackupService.BackupService
      yield* backups.create({ kind: "auto" })
      yield* TestClock.adjust("10 hours")
      yield* backups.create({ kind: "manual" })
      yield* backups.create({ kind: "safety", note: "before restoring x" })
      yield* TestClock.adjust("2 hours")

      const checks = yield* startSchedule
      expect((yield* Queue.take(checks))._tag).toBe("NotDue")
      yield* TestClock.adjust("11 hours")
      expect(yield* Queue.size(checks)).toBe(0)
      yield* TestClock.adjust("1 hour")
      expect((yield* Queue.take(checks))._tag).toBe("Taken")
      expect((yield* autoBackups).map((b) => b.createdAt)).toEqual([24 * 3_600_000, 0])
    }).pipe(Effect.scoped, Effect.provide(dataFolder)))

  it.effect("a failed backup is logged, doesn't stop the schedule, and is tried again an hour later", () =>
    Effect.gen(function* () {
      const backups = yield* BackupService.BackupService
      // A file where the backups folder should be: every backup fails until it's gone.
      fs.mkdirSync(path.dirname(backups.dir), { recursive: true })
      fs.writeFileSync(backups.dir, "in the way")

      const checks = yield* startSchedule
      const failed = yield* Queue.take(checks)
      expect(failed._tag).toBe("Failed")
      expect(failed._tag === "Failed" && failed.error).toContain(backups.dir)

      fs.rmSync(backups.dir)
      yield* TestClock.adjust("59 minutes")
      expect(yield* Queue.size(checks)).toBe(0)
      yield* TestClock.adjust("1 minute")
      expect((yield* Queue.take(checks))._tag).toBe("Taken")
      expect(yield* autoBackups).toHaveLength(1)
    }).pipe(Effect.scoped, Effect.provide(dataFolder)))
})
