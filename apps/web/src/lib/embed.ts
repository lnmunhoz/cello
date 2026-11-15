// `?embed=1`: a route shown inside a panel (an iframe beside the board, or the desktop app's browser
// panel) without the app's sidebar, breadcrumb and tabs. The root route keeps it on every navigation
// (`embedSearch`), so a page stays embedded however it navigates: opening a Review row, a task, a page.
import { retainSearchParams } from "@tanstack/react-router"

export const isEmbed = (search: Readonly<Record<string, unknown>>): boolean =>
  search["embed"] === 1 || search["embed"] === "1" || search["embed"] === true

export interface EmbedSearch {
  /** Shown in a panel, without the app shell. */
  readonly embed?: 1
}

const parseEmbedSearch = (search: Record<string, unknown>): EmbedSearch => (isEmbed(search) ? { embed: 1 } : {})

/** The root route's search options: `embed` is read on every route and kept by every navigation. */
export const embedSearch = {
  validateSearch: parseEmbedSearch,
  search: { middlewares: [retainSearchParams<EmbedSearch>(["embed"])] },
}
