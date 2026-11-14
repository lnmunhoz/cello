// What a review or a page may carry: images, videos and text files up to 50 MB, and (reviews) http(s)
// links. Types come from the file extension; anything else is refused, so the server never serves a
// page or a script.
import * as path from "node:path"
import type { AttachmentKind } from "@cello/contract/entities"
import { Invalid } from "@cello/contract/errors"
import type { EvidenceFile } from "@cello/contract/rpcs"
import * as Effect from "effect/Effect"

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

const TEXT = "text/plain; charset=utf-8"

const TYPES: Record<string, { readonly kind: Exclude<AttachmentKind, "link">; readonly mime: string }> = {
  png: { kind: "image", mime: "image/png" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  gif: { kind: "image", mime: "image/gif" },
  webp: { kind: "image", mime: "image/webp" },
  avif: { kind: "image", mime: "image/avif" },
  mp4: { kind: "video", mime: "video/mp4" },
  m4v: { kind: "video", mime: "video/mp4" },
  webm: { kind: "video", mime: "video/webm" },
  mov: { kind: "video", mime: "video/quicktime" },
  txt: { kind: "file", mime: TEXT },
  log: { kind: "file", mime: TEXT },
  out: { kind: "file", mime: TEXT },
  md: { kind: "file", mime: "text/markdown; charset=utf-8" },
  csv: { kind: "file", mime: "text/csv; charset=utf-8" },
  json: { kind: "file", mime: "application/json" },
  cast: { kind: "file", mime: "application/x-asciicast" },
}

/** The kind and mime type for a file name, or null when a review can't carry it. */
export const classify = (fileName: string): { readonly kind: Exclude<AttachmentKind, "link">; readonly mime: string } | null => {
  const dot = fileName.lastIndexOf(".")
  if (dot <= 0) return null
  return TYPES[fileName.slice(dot + 1).toLowerCase()] ?? null
}

/** The extensions `classify` accepts, for error messages. */
export const ACCEPTED = Object.keys(TYPES).join(", ")

/** A trimmed http(s) URL. */
export const requireLink = (value: string): Effect.Effect<string, Invalid> => {
  const url = value.trim()
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return Effect.succeed(url)
  } catch {}
  return Effect.fail(new Invalid({ field: "links", reason: `"${value}" isn't an http(s) link` }))
}

/** A file to store, checked before anything is written. */
export interface CheckedFile {
  readonly source: string
  readonly caption: string
  readonly kind: Exclude<AttachmentKind, "link">
  readonly mime: string
  readonly bytes: number
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** An absolute path to an existing file of an accepted type, within the size limit. */
export const checkFile = (
  sizeOf: (file: string) => Effect.Effect<number | null>,
  file: EvidenceFile,
): Effect.Effect<CheckedFile, Invalid> =>
  Effect.gen(function* () {
    const fail = (reason: string) => Effect.fail(new Invalid({ field: "files", reason }))
    if (!path.isAbsolute(file.path)) return yield* fail(`${file.path} isn't an absolute path`)
    const name = path.basename(file.path)
    const type = classify(name)
    if (type === null) return yield* fail(`${name} isn't an image, a video or a text file (accepted: ${ACCEPTED})`)
    const bytes = yield* sizeOf(file.path)
    if (bytes === null) return yield* fail(`there's no file at ${file.path}`)
    if (bytes > MAX_ATTACHMENT_BYTES) return yield* fail(`${name} is ${megabytes(bytes)}; the limit is ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`)
    return { source: file.path, caption: file.caption?.trim() ?? "", ...type, bytes }
  })
