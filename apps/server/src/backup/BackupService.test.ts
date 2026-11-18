// BackupService over a real (in-memory) database and real temp folders: what a backup folder holds,
// which folders count as Cello's backups, and retention that never touches anything else.
import { Database } from "bun:sqlite"
import * as fs from "node:fs"
import * as path from "node:path"
import { APP_VERSION } from "@cello/release/version"
import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as TestClock from "effect/testing/TestClock"
import * as AssetStore from "../review/AssetStore.ts"
import { failingCopy } from "../testing/failures.ts"
import { database } from "../testing/TestLayers.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import * as BackupService from "./BackupService.ts"
import { latestSchemaLevel } from "./database.ts"
import { backupId } from "./rules.ts"

/** A data folder in a temp dir: an in-memory database, `<dir>/assets` and `<dir>/backups`. */
const dataFolder = (options: Pick<BackupService.BackupOptions, "copyFile"> = {}) =>
  Layer.unwrap(Effect.map(tempDataDir, (dir) =>
    BackupService.layer({ dir: path.join(dir, "backups"), ...options }).pipe(
      Layer.provideMerge(Layer.succeed(AssetStore.AssetStore, AssetStore.make({ dir: path.join(dir, "assets"), ffmpeg: null }))),
      Layer.provideMerge(database()),
    )))

const run = <A, E>(
  effect: Effect.Effect<A, E, BackupService.BackupService | AssetStore.AssetStore>,
  options: Pick<BackupService.BackupOptions, "copyFile"> = {},
) => Effect.provide(effect, dataFolder(options))

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

const DAY = 86_400_000

describe("BackupService.create", () => {
  it.effect("writes <YYYYMMDD-HHMMSS>/ with a database that passes integrity_check, a copy of assets/ and a manifest", () =>
    run(Effect.gen(function* () {
      const assets = yield* AssetStore.AssetStore
      write(path.join(assets.dir, "task-1", "shot.png"), "png bytes")
      write(path.join(assets.dir, "documents", "doc-1", "notes.txt"), "some notes")
      const backups = yield* BackupService.BackupService

      const backup = yield* backups.create({ kind: "manual" })

      expect(backup.id).toBe(backupId(new Date(0)))
      expect(backup.path).toBe(path.join(backups.dir, backup.id))
      expect(fs.readdirSync(backup.path).sort()).toEqual(["assets", "cello.db", "manifest.json"])
      const db = new Database(path.join(backup.path, "cello.db"), { readonly: true })
      expect(db.query("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }])
      expect(db.query("SELECT name FROM actors").all()).toEqual([{ name: "Lucas" }])
      db.close()
      expect(fs.readFileSync(path.join(backup.path, "assets", "task-1", "shot.png"), "utf8")).toBe("png bytes")
      expect(fs.readFileSync(path.join(backup.path, "assets", "documents", "doc-1", "notes.txt"), "utf8")).toBe("some notes")

      const manifest = JSON.parse(fs.readFileSync(path.join(backup.path, "manifest.json"), "utf8"))
      expect(manifest).toEqual({
        format: "cello-backup/1",
        createdAt: 0,
        kind: "manual",
        note: null,
        appVersion: APP_VERSION,
        schemaLevel: yield* latestSchemaLevel,
        dbBytes: fs.statSync(path.join(backup.path, "cello.db")).size,
        assets: { files: 2, bytes: 19, linked: 0, copied: 2, copiedBytes: 19 },
      })
      expect(backup).toEqual({ id: backup.id, path: backup.path, ...manifest, format: undefined })
      // Nothing half-written is left beside it.
      expect(fs.readdirSync(backups.dir)).toEqual([backup.id])
    })))

  it.effect("a second backup in the same second gets its own folder", () =>
    run(Effect.gen(function* () {
      const backups = yield* BackupService.BackupService
      const first = yield* backups.create({ kind: "manual" })
      const second = yield* backups.create({ kind: "manual", note: "before restoring x" })
      expect(second.id).toBe(`${first.id}-2`)
      expect(second.note).toBe("before restoring x")
    })))

  it.effect("a backup that fails part-way leaves nothing behind, and the next one works", () => {
    let broken = true
    const copyFile = failingCopy((source) => broken && source.endsWith("locked.png"))
    return run(Effect.gen(function* () {
      const assets = yield* AssetStore.AssetStore
      write(path.join(assets.dir, "documents", "doc-1", "notes.txt"), "copied first")
      write(path.join(assets.dir, "task-1", "locked.png"), "can't be copied")
      const backups = yield* BackupService.BackupService

      const failed = yield* Effect.exit(backups.create({ kind: "manual" }))
      expect(failed._tag).toBe("Failure")
      expect(String(failed._tag === "Failure" && Cause.pretty(failed.cause))).toContain("EACCES")
      expect(fs.readdirSync(backups.dir)).toEqual([])

      broken = false
      const backup = yield* backups.create({ kind: "manual" })
      expect(fs.readdirSync(backups.dir)).toEqual([backup.id])
      expect(backup.assets).toMatchObject({ files: 2, copied: 2 })
    }), { copyFile })
  })
})

describe("BackupService.list", () => {
  it.effect("shows only Cello's backups, newest first; hand-made folders and files are ignored", () =>
    run(Effect.gen(function* () {
      const backups = yield* BackupService.BackupService
      const dir = backups.dir
      write(path.join(dir, "full-20261115-111431", "cello.db"), "hand-made full backup")
      write(path.join(dir, "20261115-111431.db"), "hand-made db-only backup")
      write(path.join(dir, "20261115-111432", "cello.db"), "no manifest")
      write(path.join(dir, "20261115-111433", "manifest.json"), "{ not json")
      write(path.join(dir, "20261115-111434", "manifest.json"), JSON.stringify({ format: "someone-else/1" }))

      const older = yield* backups.create({ kind: "auto" })
      yield* TestClock.adjust("1 hour")
      const newer = yield* backups.create({ kind: "manual" })

      expect((yield* backups.list()).map((b) => b.id)).toEqual([newer.id, older.id])
      expect(yield* backups.list()).toEqual([newer, older])
    })))
})

describe("BackupService.prune", () => {
  it.effect("a backup can be protected from the prune that follows it, like the one a restore is putting back", () =>
    run(Effect.gen(function* () {
      const backups = yield* BackupService.BackupService
      const safety: string[] = []
      for (let i = 0; i < 14; i++) {
        safety.push((yield* backups.create({ kind: "safety", note: `before restoring ${i}` })).id)
        yield* TestClock.adjust("1 hour")
      }
      const oldest = safety[0]!
      yield* backups.create({ kind: "safety", note: `before restoring ${oldest}`, protect: [oldest] })
      expect((yield* backups.list()).map((b) => b.id)).toContain(oldest)
      expect((yield* backups.list()).filter((b) => b.kind === "safety")).toHaveLength(15)
      // Unprotected, the next prune takes it.
      expect(yield* backups.prune()).toEqual([oldest])
    })))

  it.effect("keeps the newest 14 auto backups, counts manual ones apart, and never touches other folders", () =>
    run(Effect.gen(function* () {
      const backups = yield* BackupService.BackupService
      const foreign = ["full-20261115-111431", "20261115-111432", "notes"]
      for (const name of foreign) write(path.join(backups.dir, name, "cello.db"), "hand-made")
      write(path.join(backups.dir, "19700101-000000.db"), "hand-made db-only")

      const manual = yield* backups.create({ kind: "manual" })
      const autos: string[] = []
      for (let day = 0; day < 16; day++) {
        yield* TestClock.adjust(DAY)
        autos.push((yield* backups.create({ kind: "auto" })).id) // each create prunes
      }

      expect((yield* backups.list()).map((b) => b.id)).toEqual([...autos.slice(2).reverse(), manual.id])
      for (const id of autos.slice(0, 2)) expect(fs.existsSync(path.join(backups.dir, id))).toBe(false)
      for (const name of foreign) expect(fs.readFileSync(path.join(backups.dir, name, "cello.db"), "utf8")).toBe("hand-made")
      expect(fs.existsSync(path.join(backups.dir, "19700101-000000.db"))).toBe(true)
      expect(yield* backups.prune()).toEqual([])
    })))
})
