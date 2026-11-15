// The pure rules of backups: folder names, which backups retention removes, and whether an asset
// file in a new backup is a hard link to the previous backup's copy or a fresh copy.
import type { BackupKind } from "@cello/contract/backups"

/** How many backups of each kind are kept. */
export const KEEP = 14

const pad = (n: number, width = 2) => String(n).padStart(width, "0")

/** `YYYYMMDD-HHMMSS` in local time: the folder name, and the id `cello restore` takes. */
export const backupId = (date: Date): string =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`

const ID = /^\d{8}-\d{6}(?:-[1-9]\d*)?$/

/** A folder name Cello makes. Hand-made backups (`full-20261115-111431/`, `*.db`) never match. */
export const isBackupId = (name: string): boolean => ID.test(name)

/** `base`, or `base-2`, `base-3`, … when a backup in the same second already took it. */
export const freeId = (base: string, taken: (id: string) => boolean): string => {
  if (!taken(base)) return base
  let n = 2
  while (taken(`${base}-${n}`)) n++
  return `${base}-${n}`
}

export interface Retained {
  readonly id: string
  readonly kind: BackupKind
  readonly createdAt: number
}

export interface PruneOptions {
  /** How many of each kind to keep; 14 unless a test says otherwise. */
  readonly keep?: number
  /** Ids never removed, whatever their age: the backup a restore is putting back. */
  readonly protect?: ReadonlyArray<string>
}

const KINDS: ReadonlyArray<BackupKind> = ["auto", "manual", "safety"]

/**
 * The backups to remove: all but the newest `keep` of each kind. Each kind is counted apart, so a
 * burst of manual backups never pushes out two weeks of daily history or the safety backup that undoes
 * a restore, and no kind grows without bound. Protected ids stay and don't count.
 */
export const toPrune = (backups: ReadonlyArray<Retained>, options: PruneOptions = {}): ReadonlyArray<string> => {
  const keep = options.keep ?? KEEP
  const protect = new Set(options.protect ?? [])
  return KINDS.flatMap((kind) =>
    backups
      .filter((b) => b.kind === kind && !protect.has(b.id))
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
      .slice(keep)
      .map((b) => b.id)
  )
}

export interface FileFacts {
  readonly size: number
  readonly mtimeMs: number
}

/**
 * Link an asset to the previous backup's copy when it's the same file: the same size and
 * modification time (to the millisecond), or, when only the time differs, the same content.
 * `sameContent` (a sha256 comparison) only runs in that last case.
 */
export const linkOrCopy = (current: FileFacts, previous: FileFacts | null, sameContent: () => boolean): "link" | "copy" => {
  if (previous === null || previous.size !== current.size) return "copy"
  if (Math.floor(previous.mtimeMs) === Math.floor(current.mtimeMs)) return "link"
  return sameContent() ? "link" : "copy"
}
