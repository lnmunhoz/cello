// Pure reducer from events to client state. Shared by the web app and any other client.
import type { Actor, Label, Project, Review, Snapshot, Status, Task, Workspace } from "@cello/contract/entities"
import type { CelloEvent } from "@cello/contract/events"

type ById<T> = Readonly<Record<string, T>>

export interface BoardState {
  readonly seq: number
  readonly actors: ById<Actor>
  readonly workspaces: ById<Workspace>
  readonly projects: ById<Project>
  readonly statuses: ById<Status>
  readonly labels: ById<Label>
  readonly tasks: ById<Task>
  /** Open reviews only: a decided one leaves the board (the task panel loads a task's whole list). */
  readonly reviews: ById<Review>
}

const byId = <T extends { id: string }>(rows: ReadonlyArray<T>): ById<T> =>
  Object.fromEntries(rows.map((row) => [row.id, row]))

export const fromSnapshot = (s: Snapshot): BoardState => ({
  seq: s.seq,
  actors: byId(s.actors),
  workspaces: byId(s.workspaces),
  projects: byId(s.projects),
  statuses: byId(s.statuses),
  labels: byId(s.labels),
  tasks: byId(s.tasks),
  reviews: byId(s.reviews),
})

type Collection = Exclude<keyof BoardState, "seq">

/** Copies each collection at most once per batch; untouched rows keep their identity. */
class Draft {
  private copies = new Map<Collection, Record<string, unknown>>()
  constructor(private base: BoardState) {}

  get<K extends Collection>(key: K): BoardState[K] {
    return (this.copies.get(key) ?? this.base[key]) as BoardState[K]
  }

  set<K extends Collection>(key: K, id: string, row: BoardState[K][string]) {
    let copy = this.copies.get(key)
    if (!copy) this.copies.set(key, (copy = { ...this.base[key] }))
    copy[id] = row
  }

  delete<K extends Collection>(key: K, id: string) {
    if (!(id in this.get(key))) return
    let copy = this.copies.get(key)
    if (!copy) this.copies.set(key, (copy = { ...this.base[key] }))
    delete copy[id]
  }

  update<K extends Collection>(key: K, id: string, change: (row: BoardState[K][string]) => BoardState[K][string]) {
    const row = this.get(key)[id] as BoardState[K][string] | undefined
    if (row !== undefined) this.set(key, id, change(row))
  }

  finish(seq: number): BoardState {
    if (this.copies.size === 0 && seq === this.base.seq) return this.base
    return { ...this.base, ...Object.fromEntries(this.copies), seq } as BoardState
  }
}

const apply = (d: Draft, e: CelloEvent) => {
  switch (e.type) {
    case "workspace.created":
      return d.set("workspaces", e.workspace.id, e.workspace)
    case "workspace.updated":
      return d.update("workspaces", e.id, (w) => ({ ...w, ...e.after, updatedAt: e.ts }))
    case "project.created":
      return d.set("projects", e.project.id, e.project)
    case "project.updated":
      return d.update("projects", e.id, (p) => ({ ...p, ...e.after, updatedAt: e.ts }))
    case "project.archived":
      return d.update("projects", e.id, (p) => ({ ...p, archivedAt: e.ts }))
    case "status.updated":
      return d.update("statuses", e.id, (s) => ({ ...s, ...e.after, updatedAt: e.ts }))
    case "label.created":
      return d.set("labels", e.label.id, e.label)
    case "label.updated":
      return d.update("labels", e.id, (l) => ({ ...l, ...e.after, updatedAt: e.ts }))
    case "label.archived":
      return d.update("labels", e.id, (l) => ({ ...l, archivedAt: e.ts }))
    case "task.created":
      return d.set("tasks", e.task.id, e.task)
    case "task.updated":
      return d.update("tasks", e.id, (t) => ({ ...t, ...e.after, version: e.version, updatedAt: e.ts }))
    case "task.moved":
    case "task.claimed":
    case "task.claim_taken":
    case "task.released":
      return d.set("tasks", e.id, e.task)
    case "task.claim_ended":
      return d.update("tasks", e.id, (t) => ({ ...t, assigneeActorId: null, assigneeSessionId: null, version: e.version, updatedAt: e.ts }))
    case "task.labels_changed":
      return d.update("tasks", e.id, (t) => ({
        ...t,
        labelIds: [...t.labelIds.filter((id) => !e.removed.includes(id)), ...e.added.filter((id) => !t.labelIds.includes(id))],
        version: e.version,
        updatedAt: e.ts,
      }))
    case "task.archived":
      return d.update("tasks", e.id, (t) => ({ ...t, archivedAt: e.ts, version: e.version, updatedAt: e.ts }))
    case "task.unarchived":
      return d.update("tasks", e.id, (t) => ({ ...t, archivedAt: null, version: e.version, updatedAt: e.ts }))
    case "comment.added":
    case "comment.edited":
    case "comment.deleted":
      return // comments load per task, not in board state
    case "review.submitted":
      return d.set("reviews", e.review.id, e.review)
    case "review.decided":
      return d.delete("reviews", e.id)
  }
}

/** Apply ordered events; anything at or below the state's seq is ignored. */
export const applyEvents = (state: BoardState, events: ReadonlyArray<CelloEvent>): BoardState => {
  const draft = new Draft(state)
  let seq = state.seq
  for (const e of events) {
    if (e.seq <= seq) continue
    apply(draft, e)
    seq = e.seq
  }
  return draft.finish(seq)
}
