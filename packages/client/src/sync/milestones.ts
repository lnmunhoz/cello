// Read-only views of a project's milestones for the Milestones page and a milestone's page (CEL-132).
// Progress is derived here from the tasks the board already has, so a bar moves as cards move.
import type { Milestone, Task } from "@cello/contract/entities"
import { byPosition, milestoneProgress, openWithoutMilestone, type MilestoneProgress } from "@cello/domain/milestone"
import type { BoardState } from "./applyEvents.ts"
import { listGroups, type ListGroup } from "./list.ts"
import { comparePosition, statusesOf } from "./selectors.ts"

/** A project's milestones in the human's order, split into open and closed (closed: the latest closed first). */
export const milestonesOf = (state: BoardState, projectId: string): { readonly open: Milestone[]; readonly closed: Milestone[] } => {
  const all = Object.values(state.milestones).filter((m) => m.projectId === projectId).sort(byPosition)
  return {
    open: all.filter((m) => m.state === "open"),
    closed: all.filter((m) => m.state === "closed").sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
  }
}

/** A milestone's tasks that aren't archived, or with `null` the project's open tasks without one. */
export const milestoneTasks = (state: BoardState, workspaceId: string, projectId: string, milestoneId: string | null): Task[] => {
  const tasks = Object.values(state.tasks).filter((t) => t.projectId === projectId && t.archivedAt === null)
  return milestoneId === null ? openWithoutMilestone(tasks, statusesOf(state, workspaceId)) : tasks.filter((t) => t.milestoneId === milestoneId)
}

/** How far along a milestone is, from its tasks on the board. */
export const progressOf = (state: BoardState, workspaceId: string, projectId: string, milestoneId: string): MilestoneProgress =>
  milestoneProgress(milestoneTasks(state, workspaceId, projectId, milestoneId), statusesOf(state, workspaceId))

/**
 * A milestone's tasks grouped by status, as the list layout groups them (Needs input folded into In
 * Progress unless it has its own column), keeping only the groups with a task. Hidden statuses take
 * their place in the order here (Backlog first), since a milestone's Backlog is part of its plan.
 */
export const milestoneGroups = (
  state: BoardState,
  workspaceId: string,
  projectId: string,
  milestoneId: string | null,
  options: { readonly needsInputColumn: boolean },
): ListGroup[] => {
  const ids = new Set(milestoneTasks(state, workspaceId, projectId, milestoneId).map((t) => t.id))
  return listGroups(state, workspaceId, projectId, options)
    .map((g) => ({ ...g, tasks: g.tasks.filter((t) => ids.has(t.id)) }))
    .filter((g) => g.tasks.length > 0)
    .sort((a, b) => comparePosition(a.status, b.status))
}
