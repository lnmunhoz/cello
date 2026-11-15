// Backups of the data folder: `<dataDir>/backups/<YYYYMMDD-HHMMSS>/` holds cello.db, assets/ and a
// manifest.json. Schemas only; the server makes, lists and prunes them, the CLI restores one.
import * as Schema from "effect/Schema"
import { Millis } from "./entities.ts"

/**
 * `auto`: the server's daily one. `manual`: `cello backup`. `safety`: the copy of the current state
 * `cello restore` takes first, the undo for that restore. Each kind is kept apart (14 of each).
 */
export const BackupKind = Schema.Literals(["auto", "manual", "safety"])
export type BackupKind = typeof BackupKind.Type

/** The asset files a backup holds: unchanged ones are hard links to the previous backup's copy. */
export const BackupAssets = Schema.Struct({
  files: Schema.Number,
  bytes: Schema.Number,
  linked: Schema.Number,
  copied: Schema.Number,
  /** Bytes written for the copied files: what this backup added on disk, besides the database. */
  copiedBytes: Schema.Number,
})
export type BackupAssets = typeof BackupAssets.Type

const fields = {
  createdAt: Millis,
  kind: BackupKind,
  /** Why it was taken, when not on schedule: "before restoring 20261115-120000". */
  note: Schema.NullOr(Schema.String),
  appVersion: Schema.String,
  /** The newest migration the database had (0003_documents is 3). */
  schemaLevel: Schema.Number,
  dbBytes: Schema.Number,
  assets: BackupAssets,
}

/** What a backup folder's manifest.json says; the format tag marks the folder as one Cello made. */
export const BackupManifest = Schema.Struct({ format: Schema.Literal("cello-backup/1"), ...fields })
export type BackupManifest = typeof BackupManifest.Type

/** A backup: its folder name (`id`, what `cello restore` takes), absolute path, and its manifest. */
export const Backup = Schema.Struct({ id: Schema.String, path: Schema.String, ...fields })
export type Backup = typeof Backup.Type
