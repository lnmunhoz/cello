// The files reviews and pages carry, under <dataDir>/assets/: a review's in <taskId>/, a page's in
// documents/<documentId>/. Rows store paths relative to that folder.
// A failing disk is a defect, like a failing database; a missing ffmpeg only means no poster.
import * as fs from "node:fs"
import * as path from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

export class AssetStore extends Context.Service<AssetStore, {
  /** `<dataDir>/assets`. */
  readonly dir: string
  /** Size of a regular file, or null when `file` isn't one (missing, a folder, unreadable). */
  readonly sizeOf: (file: string) => Effect.Effect<number | null>
  /** Copies `source` to `<folder>/<attachmentId><ext>` and returns that relative path. */
  readonly copyIn: (source: string, folder: string, attachmentId: string) => Effect.Effect<string>
  /** The SHA-256 of a file, as hex: an unchanged file republished is recognized and stored once. */
  readonly hashOf: (file: string) => Effect.Effect<string>
  /** Grabs a frame of a stored video as `<…>.poster.jpg`; null when ffmpeg is missing or fails. */
  readonly poster: (video: string) => Effect.Effect<string | null>
  /** Deletes stored files (relative paths); a missing one is fine. */
  readonly remove: (files: ReadonlyArray<string>) => Effect.Effect<void>
  /** The absolute path of a stored file. */
  readonly resolve: (relative: string) => string
}>()("cello/AssetStore") {}

export interface AssetStoreOptions {
  readonly dir: string
  /** The ffmpeg binary for posters; null skips them. Defaults to the one on PATH. */
  readonly ffmpeg?: string | null
}

const run = (cmd: ReadonlyArray<string>) =>
  Effect.promise(async () => {
    const child = Bun.spawn([...cmd], { stdout: "ignore", stderr: "ignore" })
    return await child.exited
  })

export const make = (options: AssetStoreOptions) => {
  const dir = options.dir
  const ffmpeg = options.ffmpeg === undefined ? Bun.which("ffmpeg") : options.ffmpeg
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
    Effect.sync(() => new Bun.CryptoHasher("sha256").update(fs.readFileSync(file)).digest("hex")).pipe(Effect.withSpan("AssetStore.hashOf"))

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
      const relative = video.replace(/\.[^./]+$/, "") + ".poster.jpg"
      const out = resolve(relative)
      // Half a second in skips a black first frame; a shorter clip falls back to its first frame.
      for (const at of ["0.5", "0"]) {
        yield* run([ffmpeg, "-y", "-loglevel", "error", "-ss", at, "-i", resolve(video), "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-q:v", "4", out])
        if (nonEmpty(out)) return relative
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
