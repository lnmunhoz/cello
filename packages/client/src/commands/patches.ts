// Optimistic patches: pure functions from state to state. Untouched rows keep their identity,
// and a patch whose row is gone leaves the state alone.
import type { Label, Priority, Project, Status, Task } from "@cello/contract/entities"
import type { BoardState } from "../sync/applyEvents.ts"
import type { Patch } from "./optimistic.ts"

type Collection = Exclude<keyof BoardState, "seq">
type Row<K extends Collection> = BoardState[K][string]

const put = <K extends Collection>(state: BoardState, key: K, row: Row<K>): BoardState =>
  ({ ...state, [key]: { ...state[key], [row.id]: row } }) as BoardState

const change = <K extends Collection>(key: K, id: string, f: (row: Row<K>) => Row<K>): Patch => (state) => {
  const row = state[key][id] as Row<K> | undefined
  return row === undefined ? state : put(state, key, f(row))
}

const now = () => Date.now()

export const moveTask = (id: string, statusId: string, position: string): Patch =>
  change("tasks", id, (t) => ({ ...t, statusId, position }))

export interface TaskFields {
  readonly title?: string
  readonly description?: string
  readonly priority?: Priority
  readonly dueDate?: string | null
  readonly parentId?: string | null
}

export const updateTask = (id: string, fields: TaskFields): Patch => change("tasks", id, (t) => ({ ...t, ...fields }))

export const setTaskLabels = (id: string, add: ReadonlyArray<string>, remove: ReadonlyArray<string>): Patch =>
  change("tasks", id, (t) => ({
    ...t,
    labelIds: [...t.labelIds.filter((l) => !remove.includes(l)), ...add.filter((l) => !t.labelIds.includes(l))],
  }))

export const archiveTask = (id: string): Patch => change("tasks", id, (t) => ({ ...t, archivedAt: now() }))

export const addTask = (task: Task): Patch => (state) => put(state, "tasks", task)

export interface StatusFields {
  readonly name?: string
  readonly color?: string
  readonly hidden?: boolean
  readonly position?: string
}

export const updateStatus = (id: string, fields: StatusFields): Patch => change("statuses", id, (s: Status) => ({ ...s, ...fields }))

export const addLabel = (label: Label): Patch => (state) => put(state, "labels", label)

export const updateLabel = (id: string, fields: { readonly name?: string; readonly color?: string }): Patch =>
  change("labels", id, (l) => ({ ...l, ...fields }))

export const archiveLabel = (id: string): Patch => change("labels", id, (l) => ({ ...l, archivedAt: now() }))

export const updateProject = (id: string, fields: { readonly name?: string; readonly color?: string; readonly description?: string }): Patch =>
  change("projects", id, (p: Project) => ({ ...p, ...fields }))
