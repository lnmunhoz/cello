// Screenshots Lucas pastes (⌘V) or drops while he writes: into his answers to an ask (CEL-47) and into a
// task's comment box (CEL-73). Each is uploaded as soon as it lands, to the server's upload route for
// that box, which answers with the stored draft attachment; sending names the drafts by id.
import type { Attachment } from "@cello/contract/entities"

/** The image types Lucas can paste or drop (the server accepts the same), and the extension for a nameless one. */
export const SCREENSHOT_TYPES: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
}
export const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024

/** The pasted or dropped files to upload, each with a name the server can type; what's left out, and why. */
export const screenshotsFrom = (
  list: ReadonlyArray<{ readonly name: string; readonly type: string; readonly size: number }>,
): { readonly accepted: Array<{ readonly index: number; readonly name: string }>; readonly refused: string[] } => {
  const accepted: Array<{ index: number; name: string }> = []
  const refused: string[] = []
  list.forEach((file, index) => {
    const ext = SCREENSHOT_TYPES[file.type]
    if (ext === undefined) refused.push(`${file.name || "That file"} isn't a PNG, JPEG, GIF or WebP image`)
    else if (file.size > MAX_SCREENSHOT_BYTES) refused.push(`${file.name || "That image"} is over 20 MB`)
    else accepted.push({ index, name: /\.[a-z0-9]+$/i.test(file.name) ? file.name : `${file.name || "screenshot"}${ext}` })
  })
  return { accepted, refused }
}

/** Where a box's screenshots are uploaded: an ask's answers, or a task's comment box. */
export const uploadUrl = (to: { readonly askId: string } | { readonly taskId: string }): string =>
  "askId" in to ? `/asks/${encodeURIComponent(to.askId)}/uploads` : `/tasks/${encodeURIComponent(to.taskId)}/uploads`

/** Uploads a pasted or dropped screenshot; the server answers with its draft attachment, or why it refused it. */
export const uploadScreenshot = async (url: string, file: Blob, name: string): Promise<Attachment> => {
  const response = await fetch(`${url}?name=${encodeURIComponent(name)}`, { method: "POST", body: file })
  const body = (await response.json().catch(() => ({}))) as Attachment & { reason?: string }
  if (!response.ok) throw new Error(body.reason ? `${body.reason.charAt(0).toUpperCase()}${body.reason.slice(1)}.` : "The screenshot didn't upload.")
  return body
}

/** A plain object, as read back from JSON. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** The attachments in a saved draft's JSON value, skipping anything that isn't one. */
export const attachmentsIn = (v: unknown): Attachment[] =>
  Array.isArray(v) ? v.filter((a): a is Attachment => isRecord(a) && typeof a.id === "string") : []
