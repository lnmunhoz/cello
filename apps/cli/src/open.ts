// `cello open` (CEL-88): turns a page's address, a page's slug or a task key into the `cello://` link that
// opens it in Cello's desktop app, and hands that link to the system. Agents put the printed link in
// their replies: clicking an http link in Claude's app opens Claude's own browser, a cello:// one opens
// Cello's panel.
import { celloOpenLink, celloTaskLink, parseCelloLink } from "@cello/release/celloLink"
import { isSlug } from "@cello/text/document"
import type { Flavor } from "@cello/release/flavor"
import { formatTaskKey, parseTaskKey } from "@cello/domain/taskKey"

/** A page (its http address) or a task, with the link that opens it; or a slug to look up first. */
export type OpenTarget =
  | { readonly kind: "page"; readonly link: string; readonly url: string }
  | { readonly kind: "task"; readonly link: string; readonly key: string }
  | { readonly kind: "slug"; readonly slug: string }

const webPage = (raw: string): string | null => {
  const url = URL.parse(raw.trim())
  return url && (url.protocol === "http:" || url.protocol === "https:") ? url.href : null
}

/**
 * What `cello open` was given: a web address, a `cello://` (or `cello-dev://`) link, a task key in
 * capitals (CEL-12), or a page's slug (slugs are always lower case, so `cel-12` is a slug). Null for
 * anything else. The link it makes has this build's own scheme (`flavor`, CEL-149), so it opens the
 * app of the same flavor: Cello Dev for a dev build, the downloaded Cello.app for a release.
 */
export const openTarget = (raw: string, flavor: Flavor): OpenTarget | null => {
  const pageLink = (url: string): OpenTarget => ({ kind: "page", link: celloOpenLink(url, flavor), url })
  const taskLink = (key: string): OpenTarget => ({ kind: "task", link: celloTaskLink(key, flavor), key: key.toUpperCase() })
  const text = raw.trim()
  const link = parseCelloLink(text)
  if (link) {
    if (link.kind === "task") return taskLink(formatTaskKey(link.projectKey, link.number))
    const url = webPage(link.url)
    return url ? pageLink(url) : null
  }
  const url = webPage(text)
  if (url) return pageLink(url)
  if (/^[A-Z]/.test(text) && parseTaskKey(text)) return taskLink(text)
  return isSlug(text) ? { kind: "slug", slug: text } : null
}

/** The command that opens a link on this system: `open` on macOS, `xdg-open` on Linux; null elsewhere. */
export const openerCommand = (platform: NodeJS.Platform, link: string): string[] | null =>
  platform === "darwin" ? ["open", link] : platform === "linux" ? ["xdg-open", link] : null

/**
 * Opens a link with the system's opener, rejecting with its error output when that fails (no app
 * handles cello:// links). The binary passes this to the CLI; tests pass a fake, so nothing opens.
 */
export const systemOpener = (platform: NodeJS.Platform) => async (link: string): Promise<void> => {
  const command = openerCommand(platform, link)
  if (command === null) throw new Error(`this system (${platform}) has no opener Cello knows`)
  const proc = Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "pipe" })
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  if (code !== 0) throw new Error(stderr.trim() || `${command[0]} exited with ${code}`)
}
