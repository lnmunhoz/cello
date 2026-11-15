// Read-only views for the list layout of a project's tasks.
import type { Label, Status, Task } from "@cello/contract/entities"
import type { BoardState } from "./applyEvents.ts"
import { needsInputFold } from "./asks.ts"
import { boardColumns } from "./selectors.ts"

export interface ListGroup {
  readonly status: Status
  /** The status's open tasks in this project, in position order (the board's column order). */
  readonly tasks: ReadonlyArray<Task>
}

/**
 * One group per status: the visible ones in status order, then the hidden ones. Empty groups stay, so
 * their `+` works. While the Needs input column is off (the default), its tasks join the first
 * started group (In Progress) after that group's own, and it has no group of its own.
 */
export const listGroups = (
  state: BoardState,
  workspaceId: string,
  projectId: string,
  options: { readonly needsInputColumn: boolean } = { needsInputColumn: false },
): ListGroup[] => {
  const columns = boardColumns(state, workspaceId, projectId)
  const all = [...columns.visible, ...columns.hidden]
  const fold = needsInputFold(all, options.needsInputColumn)
  return all.flatMap((status) => {
    if (status.id === fold?.from) return []
    const tasks = columns.tasks[status.id] ?? []
    return [{ status, tasks: status.id === fold?.into ? [...tasks, ...(columns.tasks[fold.from] ?? [])] : tasks }]
  })
}

/** The task's parent for a breadcrumb, while it is loaded and not archived. */
export const parentOf = (state: BoardState, task: Task): Task | undefined => {
  const parent = task.parentId ? state.tasks[task.parentId] : undefined
  return parent && parent.archivedAt === null ? parent : undefined
}

/** The task's labels to show, in the task's order, without archived or unloaded ones. */
export const labelsOf = (state: BoardState, task: Task): Label[] =>
  task.labelIds.map((id) => state.labels[id]).filter((l): l is Label => l !== undefined && l.archivedAt === null)
