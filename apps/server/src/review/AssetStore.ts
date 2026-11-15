// The files reviews and pages carry, under <dataDir>/assets/: a review's in <taskId>/, a page's in
// documents/<documentId>/. Rows store paths relative to that folder.
// A failing disk is a defect, like a failing database; a missing ffmpeg only means no poster.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"

/** The folder inside the data folder that holds every stored file. */
export const ASSETS_DIR = "assets"

export class AssetStore extends Context.Service<AssetStore, {
  /** `<dataDir>/assets`. */
  readonly dir: string
  /** Size of a regular file, or null when `file` isn't one (missing, a folder, unreadable). */
  readonly sizeOf: (file: string) => Effect.Effect<number | null>
  /** Copies `source` to `<folder>/<attachmentId><ext>` and returns that relative path. */
  readonly copyIn: (source: string, folder: string, attachmentId: string) => Effect.Effect<string>
  /** The SHA-256 of a file, as hex: an unchanged file republished is recognized and stored once. */
  readonly hashOf: (file: string) => Effect.Effect<string>
  /**
   * Grabs a frame of a video (an absolute path) into a temp JPEG, removed when the scope closes; null
   * when ffmpeg is missing, fails or takes too long. Make it before the write that stores it: an
   * interrupt (a stopping server) kills ffmpeg, and a write can't be interrupted (CEL-17).
   */
  readonly poster: (video: string) => Effect.Effect<string | null, never, Scope.Scope>
  /** Deletes stored files (relative paths); a missing one is fine. */
  readonly remove: (files: ReadonlyArray<string>) => Effect.Effect<void>
  /** The absolute path of a stored file. */
  readonly resolve: (relative: string) => string
}>()("cello/AssetStore") {}

export interface AssetStoreOptions {
  readonly dir: string
  /** The ffmpeg binary for posters; null skips them. Defaults to the one on PATH. */
  readonly ffmpeg?: string | null
  /** How long one ffmpeg run may take before it's killed (default POSTER_TIMEOUT_MS). */
  readonly posterTimeoutMs?: number
}

/** A poster frame takes well under a second; a run still going after this is stuck. */
export const POSTER_TIMEOUT_MS = 15_000

/** The SHA-256 of a file as hex, read in 1 MB chunks so a long video never sits in memory whole. */
export const sha256File = (file: string): string => {
  const hasher = new Bun.CryptoHasher("sha256")
  const fd = fs.openSync(file, "r")
  try {
    const chunk = Buffer.allocUnsafe(1 << 20)
    for (let read = fs.readSync(fd, chunk); read > 0; read = fs.readSync(fd, chunk)) hasher.update(chunk.subarray(0, read))
  } finally {
    fs.closeSync(fd)
  }
  return hasher.digest("hex")
}

/** Runs a command to its exit code. It's killed after `timeoutMs`, or when the fiber is interrupted. */
const run = (cmd: ReadonlyArray<string>, timeoutMs: number) =>
  Effect.acquireUseRelease(
    Effect.sync(() => Bun.spawn([...cmd], { stdout: "ignore", stderr: "ignore", timeout: timeoutMs })),
    (child) => Effect.promise(() => child.exited),
    (child) => Effect.promise(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      await child.exited
    }),
  )

export const make = (options: AssetStoreOptions) => {
  const dir = options.dir
  const ffmpeg = options.ffmpeg === undefined ? Bun.which("ffmpeg") : options.ffmpeg
  const posterTimeoutMs = options.posterTimeoutMs ?? POSTER_TIMEOUT_MS
  const resolve = (relative: string) => path.join(dir, relative)

  const sizeOf = (file: string) =>
    Effect.sync(() => {
      try {
        const stat = fs.statSync(file)
        return stat.isFile() ? stat.size : null
      } catch {
        return null
      }
    })

  const copyIn = (source: string, folder: string, attachmentId: string) =>
    Effect.sync(() => {
      const relative = path.join(folder, attachmentId + path.extname(source).toLowerCase())
      fs.mkdirSync(path.join(dir, folder), { recursive: true })
      fs.copyFileSync(source, resolve(relative))
      return relative
    }).pipe(Effect.withSpan("AssetStore.copyIn"))

  const hashOf = (file: string) =>
    Effect.sync(() => sha256File(file)).pipe(Effect.withSpan("AssetStore.hashOf"))

  const nonEmpty = (file: string) => {
    try {
      return fs.statSync(file).size > 0
    } catch {
      return false
    }
  }

  const poster = (video: string) =>
    Effect.gen(function* () {
      if (ffmpeg === null) return null
      const tmp = yield* Effect.acquireRelease(
        Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "cello-poster-"))),
        (folder) => Effect.sync(() => fs.rmSync(folder, { recursive: true, force: true })),
      )
      const out = path.join(tmp, "poster.jpg")
      // Half a second in skips a black first frame; a shorter clip falls back to its first frame.
      for (const at of ["0.5", "0"]) {
        yield* run([ffmpeg, "-y", "-loglevel", "error", "-ss", at, "-i", video, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-q:v", "4", out], posterTimeoutMs)
        if (nonEmpty(out)) return out
      }
      return null
    }).pipe(Effect.withSpan("AssetStore.poster"))

  const remove = (files: ReadonlyArray<string>) =>
    Effect.sync(() => {
      for (const file of files) fs.rmSync(resolve(file), { force: true })
    })

  return AssetStore.of({ dir, sizeOf, copyIn, hashOf, poster, remove, resolve })
}

export const layer = (options: AssetStoreOptions) => Layer.sync(AssetStore, () => make(options))
