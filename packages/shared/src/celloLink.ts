// `cello://` links, which macOS hands to Cello's desktop app: `cello://CEL-3` opens that task on the
// board, `cello://open?url=<encoded>` opens a page in the app (a Cello page in the board's side panel,
// another site in the browser panel). The CLI makes them (`cello open`, `cello doc publish`, CEL-88) and
// the desktop app reads them; what it then lets a link open is the app's call (apps/desktop/src/links).
import { parseTaskKey } from "./taskKey.ts"

export const CELLO_SCHEME = "cello"

/** The link that opens `url` in Cello: what an agent puts in a reply, so a click opens Cello's panel. */
export const celloOpenLink = (url: string): string => `${CELLO_SCHEME}://open?url=${encodeURIComponent(url)}`

/** The link that opens a task on the board: `cello://CEL-12`. */
export const celloTaskLink = (key: string): string => `${CELLO_SCHEME}://${key.trim().toUpperCase()}`

export type CelloTarget =
  | { readonly kind: "task"; readonly projectKey: string; readonly number: number }
  | { readonly kind: "open"; readonly url: string }

/** What a `cello://` link asks for, or null when it isn't one or asks for nothing. */
export const parseCelloLink = (raw: string): CelloTarget | null => {
  const link = URL.parse(raw.trim())
  if (!link || link.protocol.toLowerCase() !== `${CELLO_SCHEME}:`) return null
  // `cello://CEL-3` has the key as its host; `cello:CEL-3` as its path.
  const target = (link.host || link.pathname).replace(/^\/+|\/+$/g, "")
  if (target.toLowerCase() === "open") {
    const url = link.searchParams.get("url")?.trim()
    return url ? { kind: "open", url } : null
  }
  const key = parseTaskKey(target)
  return key ? { kind: "task", projectKey: key.projectKey, number: key.number } : null
}

