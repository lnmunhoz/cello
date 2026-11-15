// `cello://` links: `cello://CEL-3` opens that task on the board, `cello://open?url=<encoded>` opens
// a page in the browser panel. macOS hands them to `open-url`; a second launch passes them in argv.
import { parseTaskKey, taskPath } from "@cello/shared/taskKey"
import { panelUrl } from "../panel/urls.ts"

export const SCHEME = "cello"

export type CelloLink =
  | { readonly kind: "task"; readonly path: string }
  | { readonly kind: "panel"; readonly url: string }

export const parseCelloLink = (raw: string): CelloLink | null => {
  const link = URL.parse(raw.trim())
  if (!link || link.protocol.toLowerCase() !== `${SCHEME}:`) return null
  // `cello://CEL-3` has the key as its host; `cello:CEL-3` as its path.
  const target = (link.host || link.pathname).replace(/^\/+|\/+$/g, "")
  if (target.toLowerCase() === "open") {
    const url = panelUrl(link.searchParams.get("url") ?? "")
    return url ? { kind: "panel", url } : null
  }
  const key = parseTaskKey(target)
  return key ? { kind: "task", path: taskPath(key.projectKey, key.number) } : null
}

/** The `cello://` link among a launch's arguments, if any. */
export const findCelloLink = (argv: ReadonlyArray<string>): string | undefined =>
  argv.find((arg) => arg.toLowerCase().startsWith(`${SCHEME}:`))
