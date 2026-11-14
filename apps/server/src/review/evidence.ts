// What a review may carry: images, videos and text files up to 50 MB, and http(s) links. Types come
// from the file extension; anything else is refused, so the server never serves a page or a script.
import type { AttachmentKind } from "@cello/contract/entities"
import { Invalid } from "@cello/contract/errors"
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
