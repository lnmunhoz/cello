// `cello://` links, which macOS hands to Cello's desktop app: `cello://CEL-3` opens that task on the
// board, `cello://open?url=<encoded>` opens a page in the app (a Cello page in the board's side panel,
// another site in the browser panel). The CLI makes them (`cello open`, `cello doc publish`, CEL-88) and
// the desktop app reads them; what it then lets a link open is the app's call (apps/desktop/src/links).
//
// Each flavor of Cello (flavor.ts, CEL-149) has its own scheme: the release `cello://`, Cello Dev
// `cello-dev://`. A build makes links with its own flavor's scheme, so a link from the dev `cello` opens
// Cello Dev and never the downloaded Cello.app beside it.
import type { Flavor } from "./flavor.ts"
import { parseTaskKey } from "@cello/domain/taskKey"

/** The scheme of a flavor's links: `cello` for the release, `cello-dev` for Cello Dev. */
export const celloScheme = (flavor: Flavor): string => (flavor === "dev" ? "cello-dev" : "cello")

/** The link that opens `url` in Cello: what an agent puts in a reply, so a click opens Cello's panel. */
export const celloOpenLink = (url: string, flavor: Flavor): string => `${celloScheme(flavor)}://open?url=${encodeURIComponent(url)}`

/** The link that opens a task on the board: `cello://CEL-12` (`cello-dev://CEL-12` from Cello Dev). */
export const celloTaskLink = (key: string, flavor: Flavor): string => `${celloScheme(flavor)}://${key.trim().toUpperCase()}`

/** Whose scheme a link has: `release` for `cello:`, `dev` for `cello-dev:`; null for any other address. */
export const linkFlavor = (raw: string): Flavor | null => {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw.trim())?.[1]?.toLowerCase()
  return scheme === celloScheme("release") ? "release" : scheme === celloScheme("dev") ? "dev" : null
}

export type CelloTarget =
  | { readonly kind: "task"; readonly projectKey: string; readonly number: number }
  | { readonly kind: "open"; readonly url: string }

/** What a `cello://` (or `cello-dev://`) link asks for, or null when it isn't one or asks for nothing. */
export const parseCelloLink = (raw: string): CelloTarget | null => {
  if (linkFlavor(raw) === null) return null
  const link = URL.parse(raw.trim())
  if (!link) return null
  // `cello://CEL-3` has the key as its host; `cello:CEL-3` as its path.
  const target = (link.host || link.pathname).replace(/^\/+|\/+$/g, "")
  if (target.toLowerCase() === "open") {
    const url = link.searchParams.get("url")?.trim()
    return url ? { kind: "open", url } : null
  }
  const key = parseTaskKey(target)
  return key ? { kind: "task", projectKey: key.projectKey, number: key.number } : null
}
