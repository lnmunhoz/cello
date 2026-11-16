// Optimistic patches: pure functions from state to state. Untouched rows keep their identity,
// and a patch whose row is gone leaves the state alone.
import type { Label, LabelGroup, Priority, Project, Status, Task } from "@cello/contract/entities"
import type { BoardState } from "../sync/applyEvents.ts"
import type { Patch } from "./optimistic.ts"

type Collection = Exclude<keyof BoardState, "seq" | "agents" | "wakes">
type Row<K extends Collection> = BoardState[K][string]

const put = <K extends Collection>(state: BoardState, key: K, row: Row<K>): BoardState =>
  ({ ...state, [key]: { ...state[key], [row.id]: row } }) as BoardState

const change = <K extends Collection>(key: K, id: string, f: (row: Row<K>) => Row<K>): Patch => (state) => {
  const row = state[key][id] as Row<K> | undefined
  return row === undefined ? state : put(state, key, f(row))
}

const now = () => Date.now()

/**
 * A change to a task, with its version bumped as the server will bump it. The next edit from this tab
 * then sends the version it will really find, instead of conflicting with this tab's own edit still in flight.
 * It's updated now, as the server will stamp it, so a list in Last updated order moves it at once.
 */
const changeTask = (id: string, f: (task: Task) => Task): Patch =>
  change("tasks", id, (t) => ({ ...f(t), version: t.version + 1, updatedAt: now() }))

export const moveTask = (id: string, statusId: string, position: string): Patch =>
  changeTask(id, (t) => ({ ...t, statusId, position }))

export interface TaskFields {
  readonly title?: string
  readonly description?: string
  readonly priority?: Priority
  readonly dueDate?: string | null
  readonly parentId?: string | null
}

export const updateTask = (id: string, fields: TaskFields): Patch => changeTask(id, (t) => ({ ...t, ...fields }))

export const setTaskLabels = (id: string, add: ReadonlyArray<string>, remove: ReadonlyArray<string>): Patch =>
  changeTask(id, (t) => ({
    ...t,
    labelIds: [...t.labelIds.filter((l) => !remove.includes(l)), ...add.filter((l) => !t.labelIds.includes(l))],
  }))

export const archiveTask = (id: string): Patch => changeTask(id, (t) => ({ ...t, archivedAt: now() }))

export const addTask = (task: Task): Patch => (state) => put(state, "tasks", task)

export interface StatusFields {
  readonly name?: string
  readonly color?: string
  readonly hidden?: boolean
  readonly position?: string
}

export const updateStatus = (id: string, fields: StatusFields): Patch => change("statuses", id, (s: Status) => ({ ...s, ...fields }))

/** A new label in its project (CEL-80), in the project's workspace; nothing when the project isn't loaded. */
export const addLabel = (label: Omit<Label, "workspaceId">): Patch => (state) => {
  const project = state.projects[label.projectId]
  return project === undefined ? state : put(state, "labels", { ...label, workspaceId: project.workspaceId })
}

export const updateLabel = (id: string, fields: { readonly name?: string; readonly color?: string; readonly group?: LabelGroup }): Patch =>
  change("labels", id, (l) => ({ ...l, ...fields }))

export const archiveLabel = (id: string): Patch => change("labels", id, (l) => ({ ...l, archivedAt: now() }))

export const updateProject = (id: string, fields: { readonly name?: string; readonly color?: string; readonly description?: string }): Patch =>
  change("projects", id, (p: Project) => ({ ...p, ...fields }))
