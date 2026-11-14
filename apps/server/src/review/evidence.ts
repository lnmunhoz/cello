// What a review or a page may carry: the file types in @cello/shared/attachment, up to 50 MB, and
// (reviews) http(s) links.
import * as path from "node:path"
import type { AttachmentKind } from "@cello/contract/entities"
import { Invalid } from "@cello/contract/errors"
import type { EvidenceFile } from "@cello/contract/rpcs"
import { ACCEPTED, classify, MAX_ATTACHMENT_BYTES } from "@cello/shared/attachment"
import * as Effect from "effect/Effect"

export { ACCEPTED, classify, MAX_ATTACHMENT_BYTES }

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
