// The search box on the Review and Agents pages (CEL-190), kept pure. It filters rows by what the human
// types; it is not saved, so a reload shows every row again.

/** What a Review row can be found by: its task's key and title, and the agent who asked or submitted. */
export const reviewFields = ({ task, author }: { readonly task: { readonly key: string; readonly title: string }; readonly author: string | null }): string[] =>
  [task.key, task.title, ...(author === null ? [] : [author])]

/**
 * The rows that match `query`, in their order. Rows in `keep` (a decision pending or just made) stay
 * whatever the query says, so a search never takes away a row that is saying what was decided: it folds
 * away as usual. An empty query is every row.
 */
export const searchRows = <Item extends { readonly task: { readonly key: string } }>(
  items: ReadonlyArray<Item>,
  query: string,
  fieldsOf: (item: Item) => ReadonlyArray<string>,
  keep: ReadonlySet<string> = new Set(),
): Item[] => (query.trim() === "" ? [...items] : items.filter((item) => keep.has(item.task.key) || matchesQuery(fieldsOf(item), query)))

/**
 * Whether a row whose searchable text is `fields` (an agent's name, a task's key and title) matches
 * `query`: every word of the query is found in some field, in any order, without regard to case. An empty
 * query matches everything, so a page with no search is exactly as it was.
 */
export const matchesQuery = (fields: ReadonlyArray<string>, query: string): boolean => {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "")
  if (words.length === 0) return true
  const haystack = fields.map((f) => f.toLowerCase())
  return words.every((word) => haystack.some((f) => f.includes(word)))
}
