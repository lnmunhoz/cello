// Read-only views over client state, shared by every screen.
import type { Project, Status, Task } from "@cello/contract/entities"
import { positionBetween } from "@cello/shared/position"
import type { BoardState } from "./applyEvents.ts"

export const byPosition = <T extends { readonly position: string }>(rows: Iterable<T>): T[] =>
  [...rows].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))

export const statusesOf = (state: BoardState, workspaceId: string): Status[] =>
  byPosition(Object.values(state.statuses).filter((s) => s.workspaceId === workspaceId))

export interface BoardColumns {
  readonly visible: ReadonlyArray<Status>
  readonly hidden: ReadonlyArray<Status>
  /** Every status id → its open tasks in this project, in position order. */
  readonly tasks: Readonly<Record<string, ReadonlyArray<Task>>>
}

export const boardColumns = (state: BoardState, workspaceId: string, projectId: string): BoardColumns => {
  const statuses = statusesOf(state, workspaceId)
  const tasks: Record<string, Task[]> = Object.fromEntries(statuses.map((s) => [s.id, []]))
  for (const t of Object.values(state.tasks)) {
    if (t.projectId === projectId && t.archivedAt === null) tasks[t.statusId]?.push(t)
  }
  for (const id of Object.keys(tasks)) tasks[id] = byPosition(tasks[id]!)
  return { visible: statuses.filter((s) => !s.hidden), hidden: statuses.filter((s) => s.hidden), tasks }
}

/**
 * Where an item lands at `index` in a list it isn't part of (yet): the neighbor ids the
 * server takes (`before` sorts before it, `after` after it) and the position to show meanwhile.
 */
export const placement = <T extends { readonly id: string; readonly position: string }>(
  list: ReadonlyArray<T>,
  index: number,
): { before: string | null; after: string | null; position: string } => {
  const prev = index > 0 ? list[index - 1] : undefined
  const next = list[index]
  return {
    before: prev?.id ?? null,
    after: next?.id ?? null,
    position: positionBetween(prev?.position ?? null, next?.position ?? null),
  }
}

export const projectsOf = (state: BoardState, workspaceId: string): Project[] =>
  Object.values(state.projects)
    .filter((p) => p.workspaceId === workspaceId && p.archivedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name))

export const projectByKey = (state: BoardState, key: string): Project | undefined => {
  const upper = key.toUpperCase()
  return Object.values(state.projects).find((p) => p.key === upper)
}

export const taskByKey = (state: BoardState, projectKey: string, number: number): Task | undefined => {
  const project = projectByKey(state, projectKey)
  if (!project) return undefined
  return Object.values(state.tasks).find((t) => t.projectId === project.id && t.number === number)
}
