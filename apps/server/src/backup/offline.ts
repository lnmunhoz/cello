// What the CLI does with a data folder no server is running for: take a backup, or restore one. Both
// hold the folder's server lock while they work, exactly like a server, so a server can't start
// halfway through and neither runs while one is up.
//
// Restore, step by step:
//   1. find the backup (only Cello's own, by manifest) and refuse one a newer Cello made
//   2. take the lock; a running server makes this fail with RestoreBlocked
//   3. take a safety backup of the current state ("before restoring <id>")
//   4. stage the backup's database and assets in `.restore-<id>-<time>/` inside the data folder (the
//      same volume, so the swap is renames) and check the staged database with integrity_check
//   5. swap: move cello.db, its -wal/-shm/-journal and assets/ aside, rename the staged ones in; if a
//      rename fails, what moved goes back
//   6. remove the staging folder (the safety backup holds what was replaced) and release the lock
import * as fs from "node:fs"
import * as path from "node:path"
import type { Backup } from "@cello/contract/backups"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Sqlite from "../persistence/Sqlite.ts"
import * as AssetStore from "../review/AssetStore.ts"
import * as ServerLock from "../server/ServerLock.ts"
import { BACKUPS_DIR, BackupService, type CreateBackup, layer as backupLayer } from "./BackupService.ts"
import { checkDatabase, latestSchemaLevel } from "./database.ts"
import { copyAssets, readBackups } from "./files.ts"

export class BackupNotFound extends Schema.TaggedError<BackupNotFound>()("BackupNotFound", {
  id: Schema.String,
  /** The backups folder that was searched. */
  dir: Schema.String,
}) {}

/** The backup's database has migrations this build doesn't know: a newer Cello made it. */
export class BackupTooNew extends Schema.TaggedError<BackupTooNew>()("BackupTooNew", {
  id: Schema.String,
  schemaLevel: Schema.Number,
  known: Schema.Number,
}) {}

/** The backup's database fails SQLite's integrity check; nothing was changed. */
export class BackupDamaged extends Schema.TaggedError<BackupDamaged>()("BackupDamaged", {
  id: Schema.String,
  problems: Schema.String,
}) {}

/** A server holds the data folder: stop it first. */
export class RestoreBlocked extends Schema.TaggedError<RestoreBlocked>()("RestoreBlocked", {
  id: Schema.String,
  dataDir: Schema.String,
  pid: Schema.Number,
  port: Schema.Number,
}) {}

export class NothingToBackUp extends Schema.TaggedError<NothingToBackUp>()("NothingToBackUp", {
  dataDir: Schema.String,
}) {}

export interface Restored {
  /** The backup now in place. */
  readonly backup: Backup
  /** The backup of what it replaced; null when the folder held nothing. */
  readonly safety: Backup | null
  /** The asset files restored. */
  readonly assets: { readonly files: number; readonly bytes: number }
}

const dbPathOf = (dataDir: string) => path.join(dataDir, ServerLock.DB_FILE)
const assetsOf = (dataDir: string) => path.join(dataDir, AssetStore.ASSETS_DIR)

/** Holds the data folder's lock for the rest of the scope, as a server would. */
const holdLock = (dataDir: string) => Layer.build(ServerLock.layer({ dataDir, port: 0 }))

/** Opens the folder's database and takes a backup of it; the database is closed again afterwards. */
const backUp = (dataDir: string, input: CreateBackup) =>
  Effect.scoped(Effect.gen(function* () {
    const layer = backupLayer({ dir: path.join(dataDir, BACKUPS_DIR) }).pipe(
      Layer.provide(Sqlite.layer(dbPathOf(dataDir))),
      Layer.provide(AssetStore.layer({ dir: assetsOf(dataDir), ffmpeg: null })),
    )
    return yield* Context.get(yield* Layer.build(layer), BackupService).create(input)
  }))

/** The folder's backups, newest first, read straight from disk: no lock needed, a server may be running. */
export const listBackups = Effect.fn("offline.list")(function* (options: { readonly dataDir: string }) {
  return readBackups(path.join(path.resolve(options.dataDir), BACKUPS_DIR))
})

/** A manual backup of a folder no server runs for. Fails with ServerAlreadyRunning while one does. */
export const backupOffline = Effect.fn("offline.backup")(function* (options: { readonly dataDir: string }) {
  const dataDir = path.resolve(options.dataDir)
  if (!fs.existsSync(dbPathOf(dataDir))) return yield* new NothingToBackUp({ dataDir })
  return yield* Effect.scoped(Effect.gen(function* () {
    yield* holdLock(dataDir)
    return yield* backUp(dataDir, { kind: "manual" })
  }))
})

/** The live files a restore replaces, the database's side files included (a stale -wal would corrupt it). */
const LIVE = [ServerLock.DB_FILE, `${ServerLock.DB_FILE}-wal`, `${ServerLock.DB_FILE}-shm`, `${ServerLock.DB_FILE}-journal`, AssetStore.ASSETS_DIR]
const STAGED = [ServerLock.DB_FILE, AssetStore.ASSETS_DIR]

/**
 * Moves the live database and assets into `<staging>/previous/` and the staged ones into the data
 * folder, all renames on one volume. If a rename fails, the staged ones go back and the live ones
 * return before the error is rethrown.
 */
const swapIn = (dataDir: string, staging: string) => {
  const previous = path.join(staging, "previous")
  fs.mkdirSync(previous)
  const movedAside: string[] = []
  const placed: string[] = []
  try {
    for (const name of LIVE) {
      if (!fs.existsSync(path.join(dataDir, name))) continue
      fs.renameSync(path.join(dataDir, name), path.join(previous, name))
      movedAside.push(name)
    }
    for (const name of STAGED) {
      fs.renameSync(path.join(staging, name), path.join(dataDir, name))
      placed.push(name)
    }
  } catch (error) {
    for (const name of placed) fs.renameSync(path.join(dataDir, name), path.join(staging, name))
    for (const name of movedAside) fs.renameSync(path.join(previous, name), path.join(dataDir, name))
    throw error
  }
}

/** Restores backup `id` into a data folder no server runs for. */
export const restore = Effect.fn("offline.restore")(function* (options: { readonly dataDir: string; readonly id: string }) {
  const dataDir = path.resolve(options.dataDir)
  const { id } = options
  const backupsDir = path.join(dataDir, BACKUPS_DIR)
  const backup = readBackups(backupsDir).find((b) => b.id === id)
  if (backup === undefined) return yield* new BackupNotFound({ id, dir: backupsDir })
  const known = yield* latestSchemaLevel
  if (backup.schemaLevel > known) return yield* new BackupTooNew({ id, schemaLevel: backup.schemaLevel, known })

  return yield* Effect.scoped(Effect.gen(function* () {
    yield* holdLock(dataDir).pipe(
      Effect.catchTag("ServerAlreadyRunning", (running) => Effect.fail(new RestoreBlocked({ id, dataDir, pid: running.pid, port: running.port }))),
    )

    const staging = path.join(dataDir, `.restore-${id}-${yield* Clock.currentTimeMillis}`)
    fs.mkdirSync(staging)
    // The staging folder goes unless a failed swap couldn't put everything back: then it holds the
    // live data, and stays for a person to recover it.
    let keepStaging = false
    const restored = yield* Effect.gen(function* () {
      const stagedDb = path.join(staging, ServerLock.DB_FILE)
      fs.copyFileSync(path.join(backup.path, ServerLock.DB_FILE), stagedDb)
      const check = checkDatabase(stagedDb)
      if (!check.ok) return yield* new BackupDamaged({ id, problems: check.problems.join("; ") })
      const assets = yield* Effect.promise(() => copyAssets(path.join(backup.path, AssetStore.ASSETS_DIR), path.join(staging, AssetStore.ASSETS_DIR), null))

      const holdsData = fs.existsSync(dbPathOf(dataDir)) || fs.existsSync(assetsOf(dataDir))
      const safety = holdsData ? yield* backUp(dataDir, { kind: "safety", note: `before restoring ${id}`, protect: [id] }) : null

      yield* Effect.sync(() => {
        try {
          swapIn(dataDir, staging)
        } catch (error) {
          keepStaging = fs.existsSync(path.join(staging, "previous")) && fs.readdirSync(path.join(staging, "previous")).length > 0
          throw error
        }
      })
      return { backup, safety, assets: { files: assets.files, bytes: assets.bytes } } satisfies Restored
    }).pipe(Effect.ensuring(Effect.sync(() => {
      if (!keepStaging) fs.rmSync(staging, { recursive: true, force: true })
    })))
    return restored
  }))
})
