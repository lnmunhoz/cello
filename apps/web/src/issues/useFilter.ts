// The Issues tab's filter (CEL-52), shared by the board, the list and the facet panel. It lives in the
// URL (`?label=bug,agents&who=agent`), so a link and a reload keep it, and on this device per project,
// so coming back to the project shows it again. A link with a filter wins over the kept one, and
// becomes the kept one: opening a task (which leaves the filter params behind) keeps showing it.
import type { BoardState } from "@cello/client/sync/applyEvents"
import {
  applyFilter,
  EMPTY_FILTER,
  filterFromSearch,
  hasFilter,
  matchContext,
  parseStoredFilter,
  searchFromFilter,
  storedFilter,
  type TaskFilter,
} from "@cello/client/sync/filters"
import { boardColumns, projectByKey } from "@cello/client/sync/selectors"
import type { Scope, Task } from "@cello/contract/entities"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useEffect } from "react"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { readStored, useStored, writeStored } from "../lib/storage.ts"
import { filterKey, sanitize, shownFilter } from "./facets.ts"

export interface FilterState {
  readonly filter: TaskFilter
  readonly active: boolean
  readonly set: (next: TaskFilter) => void
  readonly patch: (next: Partial<TaskFilter>) => void
  readonly clear: () => void
}

/** Whose labels a filter matches (CEL-80): the project in the URL, or the workspace's until it loads. */
const labelScope = (board: BoardState, workspaceId: string, projectKey: string): Scope => {
  const project = projectByKey(board, projectKey)
  return project ? { projectId: project.id } : { workspaceId }
}

/** The filter on screen and how to change it: each change is kept on this device and put in the URL. */
export const useFilter = (): FilterState => {
  const { projectKey } = useParams({ from: "/$projectKey" })
  const search = useSearch({ from: "/$projectKey" }) as Record<string, unknown>
  const key = filterKey(projectKey)
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const shown = shownFilter(search, parseStoredFilter(useStored(key)))
  const filter = board && workspaceId ? sanitize(shown, matchContext(board, labelScope(board, workspaceId, projectKey), Date.now())) : shown
  const navigate = useNavigate()
  const set = (next: TaskFilter) => {
    writeStored(key, storedFilter(next))
    void navigate({ to: ".", search: (prev) => ({ ...prev, ...searchFromFilter(next) }), replace: true })
  }
  return {
    filter,
    active: hasFilter(filter),
    set,
    patch: (next) => set({ ...filter, ...next }),
    clear: () => set(EMPTY_FILTER),
  }
}

/**
 * A link's filter becomes the project's kept filter, so it stays on screen as the URL moves on. It runs
 * when the URL's filter changes, not when the kept one does: a change made here writes both, and the
 * kept one is written first. Called once, by the Issues tab.
 */
export const useKeepLinkedFilter = (): void => {
  const { projectKey } = useParams({ from: "/$projectKey" })
  const search = useSearch({ from: "/$projectKey" }) as Record<string, unknown>
  const key = filterKey(projectKey)
  const linked = filterFromSearch(search)
  const raw = hasFilter(linked) ? storedFilter(linked) : null
  useEffect(() => {
    if (raw !== null && readStored(key) !== raw) writeStored(key, raw)
  }, [key, raw])
}

/** A project's open tasks, every status. */
export const projectTasks = (board: BoardState, workspaceId: string, projectId: string): Task[] =>
  Object.values(boardColumns(board, workspaceId, projectId).tasks).flat()

export interface Filtered {
  readonly filter: TaskFilter
  readonly active: boolean
  /** The tasks the filter keeps, of those given; all of them when no filter is on. */
  readonly keep: (tasks: ReadonlyArray<Task>) => Task[]
}

/** For the board and the list: what to keep of a column or group. */
export const useFiltered = (): Filtered => {
  const { projectKey } = useParams({ from: "/$projectKey" })
  const { filter, active } = useFilter()
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  return {
    filter,
    active,
    keep: (tasks) =>
      active && board && workspaceId
        ? applyFilter(tasks, filter, matchContext(board, labelScope(board, workspaceId, projectKey), Date.now()))
        : [...tasks],
  }
}

/** The project in the URL with its board, for the panel: null while it loads. */
export const useProjectBoard = () => {
  const { projectKey } = useParams({ from: "/$projectKey" })
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const project = board ? projectByKey(board, projectKey) : undefined
  return board && workspaceId && project ? { board, workspaceId, project } : null
}
