// Backups of the data folder: `<dataDir>/backups/<YYYYMMDD-HHMMSS>/` with
//   cello.db       a consistent copy, made with `VACUUM INTO` on the server's own connection while it runs
//   assets/        the stored files; ones unchanged since the previous backup are hard links to it
//   manifest.json  when, which kind, sizes, how many files were linked or copied, schema level, version
// A backup is assembled in `.partial-<id>/` and renamed into place once complete, so a folder with a
// manifest is always whole. After each one, retention keeps the newest 14 of each kind (auto, manual,
// safety).
//
// Why VACUUM INTO: bun:sqlite has no binding for SQLite's online backup API. VACUUM INTO writes a
// transactionally consistent snapshot straight to a file in one statement, as a plain rollback-journal
// database (no -wal beside it), and compacts it on the way. It runs on the server's single serialized
// connection, so it never lands in the middle of another request's transaction; writes wait for it,
// which takes milliseconds for a database this size.
import * as fs from "node:fs"
import * as fsp from "node:fs/promises"
import * as path from "node:path"
import type { Backup, BackupKind, BackupManifest } from "@cello/contract/backups"
import { APP_VERSION } from "@cello/release/version"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Semaphore from "effect/Semaphore"
import * as SqlClient from "effect/sql/SqlClient"
import * as AssetStore from "../review/AssetStore.ts"
import { DB_FILE } from "@cello/host/serverLock"
import { checkDatabase } from "./database.ts"
import { copyAssets, type CopyFile, MANIFEST_FILE, readBackups, toBackup } from "./files.ts"
import { backupId, freeId, toPrune } from "./rules.ts"

/** The folder inside the data folder that holds the backups. */
export const BACKUPS_DIR = "backups"

/** Where a backup is put together before it's renamed into place. */
const PARTIAL_PREFIX = ".partial-"

export interface CreateBackup {
  readonly kind: BackupKind
  /** Why it's taken, when not on schedule ("before restoring 20261115-120000"). */
  readonly note?: string
  /** Backups the prune after this one must leave alone (the one a restore is putting back). */
  readonly protect?: ReadonlyArray<string>
}

export class BackupService extends Context.Service<BackupService, {
  /** `<dataDir>/backups`. */
  readonly dir: string
  /** Takes a backup now, then prunes. A failing disk or database is a defect. */
  readonly create: (input: CreateBackup) => Effect.Effect<Backup>
  /** Cello's backups, newest first; folders it didn't make aren't listed. */
  readonly list: () => Effect.Effect<ReadonlyArray<Backup>>
  /** Removes all but the newest 14 of each kind (auto, manual, safety), never `protect`; returns their ids. */
  readonly prune: (protect?: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<string>>
}>()("cello/BackupService") {}

export interface BackupOptions {
  /** The backups folder, `<dataDir>/backups`; created on the first backup. */
  readonly dir: string
  /** For tests: a file copy that fails on purpose. */
  readonly copyFile?: CopyFile
}

/** Needs the open database (to copy it) and the asset store (to know where the files are). */
export const make = (options: BackupOptions) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const assets = yield* AssetStore.AssetStore
    const dir = path.resolve(options.dir)
    // One backup at a time: a manual one asked for during the daily one waits for it.
    const oneAtATime = yield* Semaphore.make(1)

    const list = Effect.fn("BackupService.list")(function* () {
      return readBackups(dir)
    })

    const prune = Effect.fn("BackupService.prune")(function* (protect: ReadonlyArray<string> = []) {
      const removed = toPrune(readBackups(dir), { protect })
      for (const id of removed) yield* Effect.promise(() => fsp.rm(path.join(dir, id), { recursive: true, force: true }))
      return removed
    })

    /** Copies the database into `folder` and checks the copy; returns its schema level. */
    const copyDatabase = Effect.fn("BackupService.copyDatabase")(function* (folder: string) {
      const file = path.join(folder, DB_FILE)
      yield* sql`VACUUM INTO ${file}`
      const check = checkDatabase(file)
      if (!check.ok) return yield* Effect.die(new Error(`The database copy failed SQLite's integrity check: ${check.problems.join("; ")}`))
      return { schemaLevel: check.schemaLevel, bytes: fs.statSync(file).size }
    }, Effect.orDie)

    const create = Effect.fn("BackupService.create")(function* (input: CreateBackup) {
      const now = yield* Clock.currentTimeMillis
      fs.mkdirSync(dir, { recursive: true })
      const names = fs.readdirSync(dir)
      // A partial folder can only be left by a backup that was cut off (the process died).
      for (const name of names) if (name.startsWith(PARTIAL_PREFIX)) fs.rmSync(path.join(dir, name), { recursive: true, force: true })
      const previous = readBackups(dir)[0]
      const id = freeId(backupId(new Date(now)), (name) => names.includes(name))
      const partial = path.join(dir, PARTIAL_PREFIX + id)

      const manifest = yield* Effect.gen(function* () {
        fs.mkdirSync(partial)
        const db = yield* copyDatabase(partial)
        const copied = yield* Effect.promise(() =>
          copyAssets(assets.dir, path.join(partial, AssetStore.ASSETS_DIR), previous ? path.join(previous.path, AssetStore.ASSETS_DIR) : null, options.copyFile)
        )
        const manifest: BackupManifest = {
          format: "cello-backup/1",
          createdAt: now,
          kind: input.kind,
          note: input.note ?? null,
          appVersion: APP_VERSION,
          schemaLevel: db.schemaLevel,
          dbBytes: db.bytes,
          assets: copied,
        }
        fs.writeFileSync(path.join(partial, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`)
        fs.renameSync(partial, path.join(dir, id))
        return manifest
      }).pipe(Effect.onError(() => Effect.sync(() => fs.rmSync(partial, { recursive: true, force: true }))))

      yield* prune(input.protect)
      return toBackup(id, path.join(dir, id), manifest)
    }, (effect) => oneAtATime.withPermits(1)(effect))

    return BackupService.of({ dir, create, list, prune })
  })

export const layer = (options: BackupOptions) => Layer.effect(BackupService, make(options))
