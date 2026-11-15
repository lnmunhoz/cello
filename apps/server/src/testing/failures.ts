// File operations that fail on purpose, for tests of what backup and restore do when the disk gets in
// the way. Injected rather than made with `chmod 000`, which root (the Docker test runner) reads anyway.
import * as fs from "node:fs"
import * as fsp from "node:fs/promises"

const systemError = (code: string, message: string) => Object.assign(new Error(`${code}: ${message}`), { code })

/** fs.renameSync, except it throws EPERM for the renames `fails` picks. */
export const failingRename = (fails: (from: string, to: string) => boolean) => (from: string, to: string): void => {
  if (fails(from, to)) throw systemError("EPERM", `operation not permitted, rename '${from}' -> '${to}'`)
  fs.renameSync(from, to)
}

/** fs.promises.copyFile, except it rejects with EACCES for the copies `fails` picks. */
export const failingCopy = (fails: (source: string, target: string) => boolean) => (source: string, target: string): Promise<void> =>
  fails(source, target)
    ? Promise.reject(systemError("EACCES", `permission denied, copyfile '${source}' -> '${target}'`))
    : fsp.copyFile(source, target)
