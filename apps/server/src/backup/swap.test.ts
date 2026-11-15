// The swap at the heart of restore, on real temp folders with a rename that fails on purpose: halfway
// through moving the live files aside, halfway through putting the staged ones in, and when putting
// things back fails too.
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { failingRename as failing } from "../testing/failures.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { swapIn } from "./swap.ts"

/** A data folder with live files, and a staging folder inside it with the backup's. */
const folders = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const staging = path.join(dataDir, ".restore-x")
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  write(path.join(dataDir, "cello.db"), "live db")
  write(path.join(dataDir, "cello.db-wal"), "live wal")
  write(path.join(dataDir, "cello.db-shm"), "live shm")
  write(path.join(dataDir, "assets", "t1", "a.png"), "live asset")
  write(path.join(staging, "cello.db"), "backup db")
  write(path.join(staging, "assets", "t1", "b.png"), "backup asset")
  return { dataDir, staging }
})

/** Every file under `dir` (relative path → content), skipping the staging folder. */
const contents = (dir: string): Record<string, string> =>
  Object.fromEntries(
    (fs.readdirSync(dir, { recursive: true }) as string[])
      .filter((name) => !name.startsWith(".restore-") && fs.statSync(path.join(dir, name)).isFile())
      .sort()
      .map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")]),
  )

const LIVE = { "assets/t1/a.png": "live asset", "cello.db": "live db", "cello.db-shm": "live shm", "cello.db-wal": "live wal" }
const STAGED = { "assets/t1/b.png": "backup asset", "cello.db": "backup db" }

describe("swapIn", () => {
  it.effect("moves the live database, its -wal and -shm, and assets aside, and puts the staged ones in", () =>
    Effect.gen(function* () {
      const { dataDir, staging } = yield* folders
      expect(swapIn(dataDir, staging)).toEqual({ _tag: "Swapped" })
      expect(contents(dataDir)).toEqual(STAGED)
      expect(contents(path.join(staging, "previous"))).toEqual(LIVE)
    }).pipe(Effect.scoped))

  it.effect("a rename failing halfway through moving the live files aside puts them back: nothing changed", () =>
    Effect.gen(function* () {
      const { dataDir, staging } = yield* folders
      const result = swapIn(dataDir, staging, failing((from) => from.endsWith("cello.db-shm")))
      expect(result).toMatchObject({ _tag: "RolledBack" })
      expect(String((result as { error: Error }).error.message)).toContain("EPERM")
      expect(contents(dataDir)).toEqual(LIVE)
      expect(contents(staging)).toEqual(STAGED)
    }).pipe(Effect.scoped))

  it.effect("a rename failing halfway through putting the staged files in takes them out again and puts the live ones back", () =>
    Effect.gen(function* () {
      const { dataDir, staging } = yield* folders
      // The database is in place when the assets fail.
      const result = swapIn(dataDir, staging, failing((from, to) => from === path.join(staging, "assets") && to === path.join(dataDir, "assets")))
      expect(result).toMatchObject({ _tag: "RolledBack" })
      expect(contents(dataDir)).toEqual(LIVE)
      expect(contents(staging)).toEqual(STAGED)
    }).pipe(Effect.scoped))

  it.effect("when putting things back fails too, it says so, and the live files that couldn't go back stay in previous/", () =>
    Effect.gen(function* () {
      const { dataDir, staging } = yield* folders
      const result = swapIn(dataDir, staging, failing((from, to) =>
        (from === path.join(staging, "assets") && to === path.join(dataDir, "assets")) || // placing the assets
        from === path.join(staging, "previous", "cello.db") // and moving the live database back
      ))
      expect(result).toMatchObject({ _tag: "Stuck" })
      expect(String((result as { rollbackError: Error }).rollbackError.message)).toContain("previous/cello.db")
      // The live database is safe in previous/; everything else went back.
      expect(contents(path.join(staging, "previous"))).toEqual({ "cello.db": "live db" })
      expect(contents(dataDir)).toEqual({ "assets/t1/a.png": "live asset", "cello.db-shm": "live shm", "cello.db-wal": "live wal" })
    }).pipe(Effect.scoped))
})
