// Stored files (review evidence, a page's images): what the server accepts and where it serves them.
// Types come from the file extension; anything else is refused, so the server never serves a page or
// a script. The CLI uses the same table to pick the images a page links.

/** Where the server serves a stored file: GET /attachments/<id>. */
export const attachmentPath = (id: string): string => `/attachments/${id}`

/** The stored file a URL path serves (`/attachments/<id>`, maybe with a query or anchor), or null. */
export const attachmentIdOf = (url: string): string | null => /^\/attachments\/([^/?#]+)(?:[?#].*)?$/.exec(url)?.[1] ?? null

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

export type FileKind = "image" | "video" | "file"

const TEXT = "text/plain; charset=utf-8"

const TYPES: Record<string, { readonly kind: FileKind; readonly mime: string }> = {
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
  // Plain text, so "Open in new tab" shows the file; the side panel opens a unified diff as a diff view (CEL-173).
  diff: { kind: "file", mime: TEXT },
  patch: { kind: "file", mime: TEXT },
  cast: { kind: "file", mime: "application/x-asciicast" },
}

/** The kind and mime type for a file name, or null when the server can't store it. */
export const classify = (fileName: string): { readonly kind: FileKind; readonly mime: string } | null => {
  const dot = fileName.lastIndexOf(".")
  if (dot <= 0) return null
  return TYPES[fileName.slice(dot + 1).toLowerCase()] ?? null
}

/** The extensions `classify` accepts, for error messages. */
export const ACCEPTED = Object.keys(TYPES).join(", ")
