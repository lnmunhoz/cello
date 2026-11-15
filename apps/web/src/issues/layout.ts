// Which layout a project's Issues tab shows, and how cards are ordered in it. Both live in the URL
// (`?layout=list&order=newest`), so a link and a reload keep them. The board and manual order are the
// defaults and have no param. Without `?order`, the ordering last picked for this project and layout
// on this device applies.
import { parseFilterSearch, type FilterSearch } from "@cello/client/sync/filters"
import { parseOrdering, type Ordering } from "@cello/client/sync/ordering"

export type Layout = "board" | "list"

/** The layout, the ordering, and the filter (CEL-52, `?label=bug&who=agent`; see ./useFilter.ts). */
export interface IssuesSearch extends FilterSearch {
  readonly layout?: "list"
  readonly order?: Ordering
}

/** The project route's `validateSearch`: keeps `layout=list`, a known `order` and the filter's params, and drops anything it doesn't know. */
export const parseIssuesSearch = (search: Record<string, unknown>): IssuesSearch => {
  const order = parseOrdering(search["order"])
  return { ...(search["layout"] === "list" ? { layout: "list" as const } : {}), ...(order ? { order } : {}), ...parseFilterSearch(search) }
}

export const layoutOf = (search: IssuesSearch): Layout => search.layout ?? "board"

/**
 * The search to navigate with. The board sets `layout` to undefined, which removes the param. It
 * drops `order` too, so the new layout shows the ordering saved for it.
 */
export const searchFor = (layout: Layout): IssuesSearch => ({ layout: layout === "list" ? "list" : undefined, order: undefined })

/** Where this device keeps the ordering last picked for a project's layout. */
export const orderingKey = (projectKey: string, layout: Layout): string => `cello:order:${projectKey.toUpperCase()}:${layout}`

/** The ordering shown: the URL's, else the saved one, else manual. */
export const orderingOf = (search: IssuesSearch, stored: string | null): Ordering => search.order ?? parseOrdering(stored) ?? "manual"

/** The search to navigate with after picking an ordering. Manual removes the param. */
export const orderSearch = (ordering: Ordering): IssuesSearch => ({ order: ordering === "manual" ? undefined : ordering })
