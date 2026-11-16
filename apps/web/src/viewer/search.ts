// The viewer's item lives in the URL (CEL-117): `?viewer=/CEL/pages/notes` beside whatever the page
// shows, so a reload keeps it, browser back closes it, and the side panel's Back (panelHistory.ts)
// can return to it. Only what the address doesn't already say is written: the kind for evidence known
// to be an image or a video, the title and the file name. Pure, so the codec is tested once here.
import { toViewerItem, type ViewerItem } from "./viewer.ts"

export interface ViewerSearch {
  /** The item's address: a path on the board, or an absolute URL for another site. */
  readonly viewer?: string
  readonly viewerKind?: "image" | "video" | "text"
  readonly viewerTitle?: string
  readonly viewerName?: string
}

const KEYS = ["viewer", "viewerKind", "viewerTitle", "viewerName"] as const

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

/** The root route's validation of the viewer's params: strings only, a known kind only, nothing without `viewer`. */
export const parseViewerSearch = (search: Record<string, unknown>): ViewerSearch => {
  const viewer = text(search["viewer"])
  if (!viewer) return {}
  const kind = search["viewerKind"]
  const title = text(search["viewerTitle"])
  const name = text(search["viewerName"])
  return {
    viewer,
    ...(kind === "image" || kind === "video" || kind === "text" ? { viewerKind: kind } : {}),
    ...(title ? { viewerTitle: title } : {}),
    ...(name ? { viewerName: name } : {}),
  }
}

/** The params that show `item`: its address on the board as a path, and only what that address doesn't say. */
export const viewerSearchOf = (item: ViewerItem, origin: string): ViewerSearch => {
  const url = new URL(item.url)
  const viewer = url.origin === new URL(origin).origin ? `${url.pathname}${url.search}${url.hash}` : url.href
  const derived = toViewerItem({ url: viewer, name: item.name }, origin)
  return {
    viewer,
    ...(derived?.kind !== item.kind && (item.kind === "image" || item.kind === "video" || item.kind === "text") ? { viewerKind: item.kind } : {}),
    ...(derived?.title !== item.title ? { viewerTitle: item.title } : {}),
    ...(item.name ? { viewerName: item.name } : {}),
  }
}

/** The item the params show, or null when the viewer is closed. */
export const viewerItemOf = (search: ViewerSearch, origin: string): ViewerItem | null =>
  search.viewer ? toViewerItem({ url: search.viewer, kind: search.viewerKind, title: search.viewerTitle, name: search.viewerName }, origin) : null

/** `search` with the viewer closed: each of its params set to undefined, which the router drops. */
export const withoutViewer = <S extends Record<string, unknown>>(search: S): S & Record<(typeof KEYS)[number], undefined> =>
  ({ ...search, ...Object.fromEntries(KEYS.map((key) => [key, undefined])) }) as S & Record<(typeof KEYS)[number], undefined>

/** Just the viewer's params, for a page that writes its own search and keeps the viewer open beside it. */
export const keepViewer = (search: Record<string, unknown>): ViewerSearch =>
  Object.fromEntries(KEYS.filter((key) => search[key] !== undefined).map((key) => [key, search[key]])) as ViewerSearch
