// The file side of backups: reading which folders in backups/ are Cello's, and copying a folder of
// assets where unchanged files become hard links to the previous backup's copy.
import * as fs from "node:fs"
import * as fsp from "node:fs/promises"
import * as path from "node:path"
import { type Backup, type BackupAssets, BackupManifest } from "@cello/contract/backups"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { sha256File } from "../review/AssetStore.ts"
import { type FileFacts, isBackupId, linkOrCopy } from "./rules.ts"

export const MANIFEST_FILE = "manifest.json"

const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(BackupManifest))

/** A backup folder's manifest, or none when `folder` isn't a real folder with a valid one. */
const readManifest = (folder: string): Option.Option<BackupManifest> => {
  try {
    if (!fs.lstatSync(folder).isDirectory()) return Option.none()
    return decodeManifest(fs.readFileSync(path.join(folder, MANIFEST_FILE), "utf8"))
  } catch {
    return Option.none()
  }
}

/** A manifest as the backup it describes. */
export const toBackup = (id: string, folder: string, manifest: BackupManifest): Backup => {
  const { format: _, ...fields } = manifest
  return { id, path: folder, ...fields }
}

/**
 * Cello's backups in `dir`, newest first: folders named `YYYYMMDD-HHMMSS` with a valid manifest.
 * Anything else (hand-made backups, stray files, a folder without a manifest) isn't listed, so
 * nothing ever prunes or restores it.
 */
export const readBackups = (dir: string): ReadonlyArray<Backup> => {
  let names: ReadonlyArray<string>
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter(isBackupId)
    .flatMap((id) => {
      const folder = path.join(dir, id)
      return Option.match(readManifest(folder), { onNone: () => [], onSome: (manifest) => [toBackup(id, folder, manifest)] })
    })
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
}

interface FoundFile extends FileFacts {
  /** Relative to the folder that was listed. */
  readonly relative: string
}

/** Every regular file under `dir`, recursively; none when `dir` doesn't exist. Links aren't followed. */
const listFiles = (dir: string, prefix = ""): ReadonlyArray<FoundFile> => {
  let entries: ReadonlyArray<fs.Dirent>
  try {
    entries = fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const relative = path.join(prefix, entry.name)
    if (entry.isDirectory()) return listFiles(dir, relative)
    if (!entry.isFile()) return []
    const stat = fs.statSync(path.join(dir, relative))
    return [{ relative, size: stat.size, mtimeMs: stat.mtimeMs }]
  })
}

const factsOf = (file: string): FileFacts | null => {
  try {
    const stat = fs.statSync(file)
    return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null
  } catch {
    return null
  }
}

/** Copies a file and keeps its modification time, so the next backup recognizes it unchanged. */
const copyKeepingTime = async (source: string, target: string, file: FileFacts) => {
  await fsp.copyFile(source, target)
  const seconds = file.mtimeMs / 1000
  await fsp.utimes(target, seconds, seconds)
}

/**
 * Copies every file under `from` into `to` (which must not exist yet). A file the `previous` folder
 * holds unchanged (see `linkOrCopy`) becomes a hard link to that copy instead, so a backup only adds
 * what changed. A link that fails (another volume, say) falls back to a copy. Never touches `from`
 * or `previous`.
 */
export const copyAssets = async (from: string, to: string, previous: string | null): Promise<BackupAssets> => {
  const totals = { files: 0, bytes: 0, linked: 0, copied: 0, copiedBytes: 0 }
  await fsp.mkdir(to, { recursive: true })
  for (const file of listFiles(from)) {
    const source = path.join(from, file.relative)
    const target = path.join(to, file.relative)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    const earlier = previous === null ? null : path.join(previous, file.relative)
    const decision = linkOrCopy(file, earlier === null ? null : factsOf(earlier), () => sha256File(source) === sha256File(earlier!))
    totals.files++
    totals.bytes += file.size
    if (decision === "link") {
      const linked = await fsp.link(earlier!, target).then(() => true, () => false)
      if (linked) {
        totals.linked++
        continue
      }
    }
    await copyKeepingTime(source, target, file)
    totals.copied++
    totals.copiedBytes += file.size
  }
  return totals
}
