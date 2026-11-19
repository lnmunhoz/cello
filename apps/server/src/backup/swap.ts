// The last step of restore: swap the staged database and assets in for the live ones, by renames on
// one volume. The live files move to `<staging>/previous/` first. A failing rename undoes what moved;
// if undoing fails too, whatever couldn't go back stays in previous/ and the caller must say where.
import * as fs from "node:fs"
import * as path from "node:path"
import { ASSETS_DIR } from "../review/AssetStore.ts"
import { DB_FILE } from "@cello/host/serverLock"

export type Rename = (from: string, to: string) => void

export type SwapResult =
  | { readonly _tag: "Swapped" }
  /** A rename failed and everything moved back: the data folder is as it was. */
  | { readonly _tag: "RolledBack"; readonly error: unknown }
  /** A rename failed and so did moving something back: live files may be in `<staging>/previous/`. */
  | { readonly _tag: "Stuck"; readonly error: unknown; readonly rollbackError: unknown }

/** The live files a restore replaces, the database's side files included (a stale -wal would corrupt it). */
const LIVE = [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`, `${DB_FILE}-journal`, ASSETS_DIR]
/** What the staging folder holds. */
const STAGED = [DB_FILE, ASSETS_DIR]

export const previousOf = (staging: string) => path.join(staging, "previous")

/** `rename` is fs.renameSync; tests pass one that fails on purpose. */
export const swapIn = (dataDir: string, staging: string, rename: Rename = fs.renameSync): SwapResult => {
  const previous = previousOf(staging)
  fs.mkdirSync(previous, { recursive: true })
  const movedAside: string[] = []
  const placed: string[] = []
  try {
    for (const name of LIVE) {
      if (!fs.existsSync(path.join(dataDir, name))) continue
      rename(path.join(dataDir, name), path.join(previous, name))
      movedAside.push(name)
    }
    for (const name of STAGED) {
      rename(path.join(staging, name), path.join(dataDir, name))
      placed.push(name)
    }
    return { _tag: "Swapped" }
  } catch (error) {
    // Undo in reverse: staged files out, live files back. Keep going past a failure, so as much as
    // possible ends up where it was.
    let rollbackError: unknown = undefined
    const undo = (from: string, to: string) => {
      try {
        rename(from, to)
      } catch (failure) {
        rollbackError ??= failure
      }
    }
    for (const name of placed.reverse()) undo(path.join(dataDir, name), path.join(staging, name))
    for (const name of movedAside.reverse()) undo(path.join(previous, name), path.join(dataDir, name))
    return rollbackError === undefined ? { _tag: "RolledBack", error } : { _tag: "Stuck", error, rollbackError }
  }
}
