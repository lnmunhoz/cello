import { applyFilter, matchContext } from "@cello/client/sync/filters"
import { useParams, useSearch } from "@tanstack/react-router"
import { BoardPage } from "../board/BoardPage.tsx"
import { Button } from "../components/ui/Button.tsx"
import { ListPage } from "../list/ListPage.tsx"
import { FacetPanel } from "./FacetPanel.tsx"
import { filterSummary } from "./facets.ts"
import { layoutOf } from "./layout.ts"
import { projectTasks, useFilter, useKeepLinkedFilter, useProjectBoard } from "./useFilter.ts"

/**
 * The Issues tab, with or without a task open (`/:projectKey/issues`, `/:projectKey/:number`), in the
 * layout the URL names, with the filter panel on its left (CEL-52). Both routes use this one component,
 * so opening or closing a task keeps the page as it was (folded groups, row focus, the panel) instead
 * of mounting it again.
 */
export function IssuesPage() {
  const { number } = useParams({ strict: false }) as { number?: string }
  const layout = layoutOf(useSearch({ from: "/$projectKey" }))
  const openNumber = number === undefined ? undefined : Number(number)
  useKeepLinkedFilter()
  return (
    <div className="flex min-h-0 flex-1">
      <FacetPanel />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col pl-1">
        <FilterNotice />
        {layout === "list" ? <ListPage openNumber={openNumber} /> : <BoardPage openNumber={openNumber} />}
      </div>
    </div>
  )
}

/**
 * While a filter is on, what the page can't show by itself: in a narrow window, where the panel is
 * hidden, a strip saying a filter narrows what you see ("Filtered: 6 of 30 tasks · Clear"); at any
 * width, a line when it hides every task.
 */
function FilterNotice() {
  const state = useFilter()
  const loaded = useProjectBoard()
  if (!loaded || !state.active) return null
  const { board, workspaceId, project } = loaded
  const tasks = projectTasks(board, workspaceId, project.id).filter((t) => t.number > 0)
  const shown = applyFilter(tasks, state.filter, matchContext(board, workspaceId, Date.now())).length
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 text-[13px] text-muted md:hidden" data-filter-strip>
        <span className="tabular-nums">{filterSummary(shown, tasks.length)}</span>
        <span aria-hidden className="text-faint">·</span>
        <Button variant="ghost" size="sm" onClick={state.clear}>
          Clear
        </Button>
      </div>
      {shown === 0 ? (
        <div className="flex shrink-0 items-center gap-3 px-3 pb-2 text-[13px] text-muted" data-filter-empty>
          No tasks match these filters.
          <Button variant="secondary" size="sm" onClick={state.clear}>
            Clear filters
          </Button>
        </div>
      ) : null}
    </>
  )
}
