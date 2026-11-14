// Read-only views for the list layout of a project's tasks.
import type { Label, Status, Task } from "@cello/contract/entities"
import type { BoardState } from "./applyEvents.ts"
import { boardColumns } from "./selectors.ts"

export interface ListGroup {
  readonly status: Status
  /** The status's open tasks in this project, in position order (the board's column order). */
  readonly tasks: ReadonlyArray<Task>
}

/** One group per status: the visible ones in status order, then the hidden ones. Empty groups stay, so their `+` works. */
export const listGroups = (state: BoardState, workspaceId: string, projectId: string): ListGroup[] => {
  const columns = boardColumns(state, workspaceId, projectId)
  return [...columns.visible, ...columns.hidden].map((status) => ({ status, tasks: columns.tasks[status.id] ?? [] }))
}

/** The task's parent for a breadcrumb, while it is loaded and not archived. */
export const parentOf = (state: BoardState, task: Task): Task | undefined => {
  const parent = task.parentId ? state.tasks[task.parentId] : undefined
  return parent && parent.archivedAt === null ? parent : undefined
}

/** The task's labels to show, in the task's order, without archived or unloaded ones. */
export const labelsOf = (state: BoardState, task: Task): Label[] =>
  task.labelIds.map((id) => state.labels[id]).filter((l): l is Label => l !== undefined && l.archivedAt === null)
