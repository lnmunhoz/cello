// What the CLI does with a data folder no server is running for: take a backup, or restore one. Both
// hold the folder's server lock while they work, exactly like a server, so a server can't start
// halfway through and neither runs while one is up.
//
// Restore, step by step:
//   1. find the backup (only Cello's own, by manifest) and refuse one a newer Cello made
//   2. take the lock; a running server makes this fail with RestoreBlocked
//   3. stage the backup's database and assets in `.restore-<id>-<time>/` inside the data folder (the
//      same volume, so the swap is renames) and check the staged database with integrity_check
//   4. take a safety backup of the current state ("before restoring <id>", kind safety)
//   5. swap (swap.ts): move cello.db, its -wal/-shm/-journal and assets/ aside into the staging
//      folder's previous/, rename the staged ones in; if a rename fails, what moved goes back
//   6. remove the staging folder (the safety backup holds what was replaced) and release the lock
// Nothing in the data folder changes before step 5. A failure anywhere is a RestoreFailed that says
// whether the folder is unchanged, names the safety backup, and, if moving things back failed too,
// where the live files are.
import * as fs from "node:fs"
import * as path from "node:path"
import type { Backup } from "@cello/contract/backups"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Sqlite from "../persistence/Sqlite.ts"
import * as AssetStore from "../review/AssetStore.ts"
import * as ServerLock from "../server/ServerLock.ts"
import { BACKUPS_DIR, BackupService, type CreateBackup, layer as backupLayer } from "./BackupService.ts"
import { checkDatabase, latestSchemaLevel } from "./database.ts"
import { copyAssets, type CopyFile, readBackups } from "./files.ts"
import { previousOf, type Rename, swapIn } from "./swap.ts"

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

/** A server holds the data folder: stop it first. Nothing was changed. */
export class RestoreBlocked extends Schema.TaggedError<RestoreBlocked>()("RestoreBlocked", {
  id: Schema.String,
  dataDir: Schema.String,
  pid: Schema.Number,
  port: Schema.Number,
}) {}

/** The disk or a file got in the way of a restore. */
export class RestoreFailed extends Schema.TaggedError<RestoreFailed>()("RestoreFailed", {
  id: Schema.String,
  dataDir: Schema.String,
  /** What it was doing: "copying the backup", "taking the safety backup", "swapping the files in". */
  step: Schema.String,
  /** The system's error, e.g. "EPERM: operation not permitted, rename …". */
  reason: Schema.String,
  /** True when the data folder is exactly as it was before. */
  unchanged: Schema.Boolean,
  /** The safety backup of the state before the restore, once it was taken. */
  safetyId: Schema.NullOr(Schema.String),
  /** Set when moving the live files back failed: they're in `<keptAt>/previous/`. */
  keptAt: Schema.NullOr(Schema.String),
}) {}

export class NothingToBackUp extends Schema.TaggedError<NothingToBackUp>()("NothingToBackUp", {
  dataDir: Schema.String,
}) {}

/** The disk or a file got in the way of a backup; the half-made backup was removed. */
export class BackupFailed extends Schema.TaggedError<BackupFailed>()("BackupFailed", {
  dataDir: Schema.String,
  reason: Schema.String,
}) {}

export interface Restored {
  /** The backup now in place. */
  readonly backup: Backup
  /** The backup of what it replaced; null when the folder held nothing. */
  readonly safety: Backup | null
  /** The asset files restored, and how many the backup's manifest lists (more means some were missing). */
  readonly assets: { readonly files: number; readonly bytes: number; readonly expected: number }
}

/** A defect's message: the system's error for a failing disk, also when it arrives over RPC as a plain object. */
export const reasonOf = (defect: unknown): string =>
  Predicate.hasProperty(defect, "message") && typeof defect.message === "string" ? defect.message : String(defect)

const dbPathOf = (dataDir: string) => path.join(dataDir, ServerLock.DB_FILE)

/** Does `dir` hold anything? When it can't be read, assume it does: that's the side that keeps data. */
const holdsFiles = (dir: string): boolean => {
  try {
    return fs.readdirSync(dir).length > 0
  } catch {
    return true
  }
}
const assetsOf = (dataDir: string) => path.join(dataDir, AssetStore.ASSETS_DIR)

/** Holds the data folder's lock for the rest of the scope, as a server would. */
const holdLock = (dataDir: string) => Layer.build(ServerLock.layer({ dataDir, port: 0 }))

/** Opens the folder's database and takes a backup of it; the database is closed again afterwards. */
const backUp = (dataDir: string, input: CreateBackup, copyFile?: CopyFile) =>
  Effect.scoped(Effect.gen(function* () {
    const layer = backupLayer({ dir: path.join(dataDir, BACKUPS_DIR), ...(copyFile ? { copyFile } : {}) }).pipe(
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
export const backupOffline = Effect.fn("offline.backup")(function* (options: {
  readonly dataDir: string
  /** For tests: a file copy that fails on purpose. */
  readonly copyFile?: CopyFile
}) {
  const dataDir = path.resolve(options.dataDir)
  if (!fs.existsSync(dbPathOf(dataDir))) return yield* new NothingToBackUp({ dataDir })
  return yield* Effect.scoped(Effect.gen(function* () {
    yield* holdLock(dataDir)
    return yield* backUp(dataDir, { kind: "manual" }, options.copyFile)
  })).pipe(Effect.catchDefect((defect) => Effect.fail(new BackupFailed({ dataDir, reason: reasonOf(defect) }))))
})

export interface RestoreOptions {
  readonly dataDir: string
  readonly id: string
  /** For tests: a rename that fails on purpose during the swap. */
  readonly rename?: Rename
  /** For tests: a file copy that fails on purpose. */
  readonly copyFile?: CopyFile
}

/** Restores backup `id` into a data folder no server runs for. */
export const restore = Effect.fn("offline.restore")(function* (options: RestoreOptions) {
  const dataDir = path.resolve(options.dataDir)
  const { id } = options
  const backupsDir = path.join(dataDir, BACKUPS_DIR)
  const backup = readBackups(backupsDir).find((b) => b.id === id)
  if (backup === undefined) return yield* new BackupNotFound({ id, dir: backupsDir })
  const known = yield* latestSchemaLevel
  if (backup.schemaLevel > known) return yield* new BackupTooNew({ id, schemaLevel: backup.schemaLevel, known })

  // What a failure reports: the step it was on, and the safety backup once there is one.
  let step = "taking the data folder's lock"
  let safetyId: string | null = null
  const failed = (defect: unknown, outcome: { readonly unchanged: boolean; readonly keptAt: string | null } = { unchanged: true, keptAt: null }) =>
    new RestoreFailed({ id, dataDir, step, reason: reasonOf(defect), safetyId, ...outcome })

  return yield* Effect.scoped(Effect.gen(function* () {
    yield* holdLock(dataDir).pipe(
      Effect.catchTag("ServerAlreadyRunning", (running) => Effect.fail(new RestoreBlocked({ id, dataDir, pid: running.pid, port: running.port }))),
    )

    step = "copying the backup"
    const staging = path.join(dataDir, `.restore-${id}-${yield* Clock.currentTimeMillis}`)
    // Kept only when a failed swap couldn't put the live files back: then it holds them.
    let keepStaging = false
    return yield* Effect.gen(function* () {
      fs.mkdirSync(staging)
      const stagedDb = path.join(staging, ServerLock.DB_FILE)
      fs.copyFileSync(path.join(backup.path, ServerLock.DB_FILE), stagedDb)
      const check = checkDatabase(stagedDb)
      if (!check.ok) return yield* new BackupDamaged({ id, problems: check.problems.join("; ") })
      const assets = yield* Effect.promise(() =>
        copyAssets(path.join(backup.path, AssetStore.ASSETS_DIR), path.join(staging, AssetStore.ASSETS_DIR), null, options.copyFile)
      )

      step = "taking the safety backup"
      const holdsData = fs.existsSync(dbPathOf(dataDir)) || fs.existsSync(assetsOf(dataDir))
      const safety = holdsData ? yield* backUp(dataDir, { kind: "safety", note: `before restoring ${id}`, protect: [id] }, options.copyFile) : null
      safetyId = safety?.id ?? null

      step = "swapping the files in"
      const swapped = swapIn(dataDir, staging, options.rename)
      if (swapped._tag === "RolledBack") return yield* failed(swapped.error)
      if (swapped._tag === "Stuck") {
        // Keep it first: if looking inside fails, `ensuring` must still leave previous/ alone.
        keepStaging = true
        keepStaging = holdsFiles(previousOf(staging))
        return yield* failed(swapped.error, { unchanged: false, keptAt: keepStaging ? staging : null })
      }
      return { backup, safety, assets: { files: assets.files, bytes: assets.bytes, expected: backup.assets.files } } satisfies Restored
    }).pipe(
      Effect.catchDefect((defect) => Effect.fail(failed(defect))),
      Effect.ensuring(Effect.sync(() => {
        // Best effort: a staging folder left behind only holds copies.
        if (!keepStaging) fs.rmSync(staging, { recursive: true, force: true, maxRetries: 2 })
      }).pipe(Effect.catchDefect(() => Effect.void))),
    )
  })).pipe(Effect.catchDefect((defect) => Effect.fail(failed(defect))))
})
