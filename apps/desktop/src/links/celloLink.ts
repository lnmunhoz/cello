// `cello://` links: `cello://CEL-3` opens that task on the board, `cello://open?url=<encoded>` opens
// a page: one on the board in the board's side panel, another site in the browser panel. macOS hands
// them to `open-url`; a second launch passes them in argv.
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

/**
 * Where a link goes once the board at `boardOrigin` is up. A page on the board (a Cello page or doc, a
 * stored text file) goes to the board window, which opens it in its own side panel (CEL-60), the way a
 * task link goes to the board; the built-in browser panel keeps outside sites only. A user name and
 * password in the address are dropped first: a link never carries them anywhere.
 */
export type LinkRoute = CelloLink | { readonly kind: "board"; readonly url: string }

export const routeCelloLink = (link: CelloLink, boardOrigin: string): LinkRoute => {
  if (link.kind !== "panel") return link
  const url = new URL(link.url)
  url.username = ""
  url.password = ""
  return url.origin === new URL(boardOrigin).origin ? { kind: "board", url: url.href } : { kind: "panel", url: url.href }
}

/** The `cello://` link among a launch's arguments, if any. */
export const findCelloLink = (argv: ReadonlyArray<string>): string | undefined =>
  argv.find((arg) => arg.toLowerCase().startsWith(`${SCHEME}:`))
