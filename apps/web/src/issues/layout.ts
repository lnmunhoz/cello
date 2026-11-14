// Which layout a project's Issues tab shows. It lives in the URL (`?layout=list`), so a link and a reload keep it.
// The board is the default and has no param.
export type Layout = "board" | "list"

export interface IssuesSearch {
  readonly layout?: "list"
}

/** The project route's `validateSearch`: keeps `layout=list` and drops anything it doesn't know. */
export const parseIssuesSearch = (search: Record<string, unknown>): IssuesSearch => (search["layout"] === "list" ? { layout: "list" } : {})

export const layoutOf = (search: IssuesSearch): Layout => search.layout ?? "board"

/** The search to navigate with. The board sets `layout` to undefined, which removes the param. */
export const searchFor = (layout: Layout): IssuesSearch => ({ layout: layout === "list" ? "list" : undefined })
