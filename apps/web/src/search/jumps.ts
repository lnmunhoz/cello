// The "Go to" rows at the top of the ⌘K bar for a query that names a task (CEL-162): `CEL-147` and
// `cel 147` are one task, a bare `147` is every project's task with that number.
import type { SearchResults } from "@cello/contract/search"
import { formatTaskKey } from "@cello/shared/taskKey"

/** The task keys to offer for what `parseTaskQuery` read: a bare number lists each project's, the current project's first. */
export const jumpKeys = (
  parsed: { projectKey: string | null; number: number } | null,
  projectKeys: ReadonlyArray<string>,
  currentKey: string | null,
): string[] => {
  if (!parsed) return []
  if (parsed.projectKey !== null) return [formatTaskKey(parsed.projectKey, parsed.number)]
  const ordered = [...projectKeys.filter((k) => k === currentKey), ...projectKeys.filter((k) => k !== currentKey)]
  return ordered.map((k) => formatTaskKey(k, parsed.number))
}

/** The results without the tasks in `taskIds` (the ones with a Go to row), totals corrected, emptied groups dropped. */
export const withoutTasks = (results: SearchResults | null, taskIds: ReadonlySet<string>): SearchResults | null => {
  if (!results || taskIds.size === 0) return results
  const groups = results.groups.flatMap((g) => {
    if (g.kind !== "task") return [g]
    const hits = g.hits.filter((h) => !taskIds.has(h.id))
    const total = g.total - (g.hits.length - hits.length)
    return total > 0 || hits.length > 0 ? [{ ...g, hits, total }] : []
  })
  return { ...results, groups }
}
