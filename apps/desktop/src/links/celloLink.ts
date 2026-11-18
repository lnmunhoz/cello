// `cello://` links: `cello://CEL-3` opens that task on the board, `cello://open?url=<encoded>` opens
// a page: one on the board in the board's side panel, another site in the browser panel. macOS hands
// them to `open-url`; a second launch passes them in argv. The link format is shared with the CLI,
// which makes them (@cello/release/celloLink, CEL-88); this file decides what the app lets them open.
// Each app follows only its own flavor's scheme (CEL-149): Cello Dev `cello-dev://`, Cello `cello://`.
import { linkFlavor, parseCelloLink as parseLinkTarget } from "@cello/release/celloLink"
import type { Flavor } from "@cello/release/flavor"
import { taskPath } from "@cello/domain/taskKey"
import { panelUrl } from "../panel/urls.ts"

export type CelloLink =
  | { readonly kind: "task"; readonly path: string }
  | { readonly kind: "panel"; readonly url: string }

/** A link of this app's flavor the app follows: a task, or a web page (http or https) for a panel. Anything else is null. */
export const parseCelloLink = (raw: string, flavor: Flavor): CelloLink | null => {
  if (linkFlavor(raw) !== flavor) return null
  const target = parseLinkTarget(raw)
  if (target === null) return null
  if (target.kind === "task") return { kind: "task", path: taskPath(target.projectKey, target.number) }
  const url = panelUrl(target.url)
  return url ? { kind: "panel", url } : null
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

/** The link of this app's flavor among a launch's arguments, if any. */
export const findCelloLink = (argv: ReadonlyArray<string>, flavor: Flavor): string | undefined =>
  argv.find((arg) => linkFlavor(arg) === flavor)
