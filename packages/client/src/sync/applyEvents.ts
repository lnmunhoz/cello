// Pure reducer from events to client state. Shared by the web app and any other client.
import { type Actor, type AgentSession, agentKey, type Ask, type DocumentSummary, type Label, type Milestone, type Project, type Review, type SessionAgent, type Snapshot, type Status, type Task, type TaskWake, type Workspace } from "@cello/contract/entities"
import type { CelloEvent } from "@cello/contract/events"
import { wakeOf } from "@cello/contract/wake"
import { colorFromSeed } from "@cello/shared/color"

type ById<T> = Readonly<Record<string, T>>

export interface BoardState {
  readonly seq: number
  readonly actors: ById<Actor>
  readonly workspaces: ById<Workspace>
  readonly projects: ById<Project>
  readonly statuses: ById<Status>
  readonly labels: ById<Label>
  /** The projects' milestones (CEL-113), closed ones too: a task may still be in one. */
  readonly milestones: ById<Milestone>
  readonly tasks: ById<Task>
  /** Agent sessions the tasks name, kept current by `session.seen` (who's working right now, CEL-35). */
  readonly sessions: ById<AgentSession>
  /** Subagents of those sessions (CEL-55), by `agentKey(sessionId, agentId)`, kept current by `agent.seen`. */
  readonly agents: ById<SessionAgent>
  /** Open reviews only: a decided one leaves the board (the task panel loads a task's whole list). */
  readonly reviews: ById<Review>
  /** Open asks only (Needs input): an answered or withdrawn one leaves the board (the task panel loads a task's list). */
  readonly asks: ById<Ask>
  /** Documents without their bodies, archived ones included (the reader loads a body). */
  readonly documents: ById<DocumentSummary>
  /** Each task's latest wake (CEL-92), by task id, kept current by the `session.*` wake events. */
  readonly wakes: ById<TaskWake>
  /**
   * When each task's latest test run finished (CEL-181), by task id, kept current by `tests.finished`. It's
   * on the task's history and is no change to the task (its version stays), so this is how an open history
   * knows to fetch again.
   */
  readonly testOutcomes: ById<{ readonly taskId: string; readonly ts: number }>
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
  milestones: byId(s.milestones ?? []),
  tasks: byId(s.tasks),
  sessions: byId(s.sessions),
  agents: Object.fromEntries(s.agents.map((a) => [agentKey(a.sessionId, a.agentId), a])),
  reviews: byId(s.reviews),
  asks: byId(s.asks),
  documents: byId(s.documents),
  wakes: Object.fromEntries((s.wakes ?? []).map((w) => [w.taskId, w])),
  testOutcomes: {},
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

/** Activity on a task that isn't a task event (a comment): its author and time are the last change. */
const activity = (e: CelloEvent, t: Task) => ({
  version: t.version + 1,
  updatedAt: e.ts,
  updatedByActorId: e.actorId,
  updatedBySessionId: e.sessionId,
  updatedByAgentId: e.agentId ?? null,
})

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
    case "milestone.created":
      return d.set("milestones", e.milestone.id, e.milestone)
    case "milestone.updated":
      return d.update("milestones", e.id, (m) => ({ ...m, ...e.after, updatedAt: e.ts }))
    case "milestone.closed":
      return d.update("milestones", e.id, (m) => ({ ...m, state: "closed", closedAt: e.ts, updatedAt: e.ts }))
    case "milestone.reopened":
      return d.update("milestones", e.id, (m) => ({ ...m, state: "open", closedAt: null, updatedAt: e.ts }))
    case "task.created":
      return d.set("tasks", e.task.id, e.task)
    case "task.updated":
      return d.update("tasks", e.id, (t) => ({ ...t, ...e.after, version: e.version, updatedAt: e.ts }))
    case "task.moved":
    case "task.claimed":
    case "task.claim_taken":
    case "task.released":
    case "task.reopened":
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
    case "task.milestone_changed":
      return d.update("tasks", e.id, (t) => ({ ...t, milestoneId: e.after, version: e.version, updatedAt: e.ts }))
    case "task.archived":
      return d.update("tasks", e.id, (t) => ({ ...t, archivedAt: e.ts, version: e.version, updatedAt: e.ts }))
    case "task.unarchived":
      return d.update("tasks", e.id, (t) => ({ ...t, archivedAt: null, version: e.version, updatedAt: e.ts }))
    case "task.stage_changed":
      return d.update("tasks", e.id, (t) => ({ ...t, stage: e.after, version: e.version, updatedAt: e.ts }))
    case "session.seen":
      // An agent that appeared after the snapshot: known by its client's name until a reload brings the actor.
      if (!(e.session.actorId in d.get("actors"))) {
        d.set("actors", e.session.actorId, {
          id: e.session.actorId,
          kind: "agent",
          name: e.session.clientName,
          client: e.session.clientName,
          color: colorFromSeed(e.session.externalId ?? e.session.id),
          createdAt: e.ts,
        })
      }
      // Its latest woken run (CEL-137) comes with it only where the server looked; else what's known stays.
      return d.set("sessions", e.session.id, "lastRun" in e.session ? e.session : { ...e.session, lastRun: d.get("sessions")[e.session.id]?.lastRun ?? null })
    case "agent.seen":
      return d.set("agents", agentKey(e.agent.sessionId, e.agent.agentId), e.agent)
    // A session's `cello inbox --wait` opened or closed (CEL-76): a comment reaches it at once while it waits.
    case "session.waiting":
      if (!(e.session in d.get("sessions"))) return
      return d.update("sessions", e.session, (s) => ({ ...s, waiting: e.waiting }))
    // `cello sessions orchestrate on|off` (CEL-124).
    case "session.orchestrating":
      if (!(e.session in d.get("sessions"))) return
      return d.update("sessions", e.session, (s) => ({ ...s, orchestrating: e.orchestrating }))
    // Comments load per task; the board keeps each task's count and latest comment time. A comment is
    // activity: the server set the task's last change and bumped its version in the same command.
    case "comment.added":
      return d.update("tasks", e.comment.taskId, (t) => ({ ...t, ...activity(e, t), commentCount: t.commentCount + 1, lastCommentAt: e.ts }))
    case "comment.edited":
      if (e.taskId === undefined) return // stored before edits named their task
      return d.update("tasks", e.taskId, (t) => ({ ...t, ...activity(e, t), lastCommentAt: e.ts }))
    case "comment.deleted":
      if (e.taskId === undefined) return
      return d.update("tasks", e.taskId, (t) => ({
        ...t,
        ...activity(e, t),
        commentCount: Math.max(0, t.commentCount - 1),
        // The latest remaining comment, from the server; older events didn't say, so it stays.
        lastCommentAt: e.lastCommentAt === undefined ? t.lastCommentAt : e.lastCommentAt,
      }))
    case "review.submitted":
      return d.set("reviews", e.review.id, e.review)
    case "review.decided":
    case "review.withdrawn":
      return d.delete("reviews", e.id)
    case "ask.created":
      return d.set("asks", e.ask.id, e.ask)
    case "ask.answered":
      return d.delete("asks", e.ask.id)
    case "ask.withdrawn":
      return d.delete("asks", e.id)
    case "document.published":
      return d.set("documents", e.document.id, e.document)
    case "document.updated":
      return d.set("documents", e.id, e.document)
    case "document.archived":
      return d.update("documents", e.id, (doc) => ({ ...doc, archivedAt: e.ts }))
    case "build.recorded":
      return // builds load on the Builds page, not in board state
    case "profile.changed":
      return // testing profiles load in Settings (sync/profile.ts), not in board state
    case "comment.delivered":
      return // receipts load with a task's comments (sync/comments.ts); taking one is no activity on the task
    case "reaction.added":
    case "reaction.removed":
      return // reactions load with a task's comments (sync/comments.ts); they're no activity on the task
    case "session.run_started":
    case "session.run_ended": {
      // The session's latest woken run (CEL-137): it's Woken by Cello, and active, while it goes.
      const { id, sessionId, startedAt, endedAt } = e.run
      if (sessionId in d.get("sessions")) d.update("sessions", sessionId, (s) => ({ ...s, lastRun: { id, startedAt, endedAt } }))
      const wake = wakeOf(e)
      return wake === null ? undefined : d.set("wakes", wake.taskId, wake)
    }
    case "session.wake_scheduled":
    case "session.not_woken": {
      const wake = wakeOf(e)
      return wake === null ? undefined : d.set("wakes", wake.taskId, wake)
    }
    case "wake.settings_changed":
      return // wake settings load in Settings, not in board state
    // A test run finished on a task (CEL-181): part of its history, no change to the task, so only the time is kept.
    case "tests.finished":
      return d.set("testOutcomes", e.taskId, { taskId: e.taskId, ts: e.ts })
  }
}

/** Apply ordered events; anything at or below the state's seq is ignored. */
export const applyEvents = (state: BoardState, events: ReadonlyArray<CelloEvent>): BoardState => {
  const draft = new Draft(state)
  let seq = state.seq
  for (const e of events) {
    if (e.seq <= seq) continue
    apply(draft, e)
    // Every change to a task records who made it (CEL-5), as the server does in the same command; events
    // that carry the whole task already have it.
    if (e.type.startsWith("task.") && "id" in e && !("task" in e)) {
      draft.update("tasks", e.id, (t) => ({ ...t, updatedByActorId: e.actorId, updatedBySessionId: e.sessionId, updatedByAgentId: e.agentId ?? null }))
    }
    seq = e.seq
  }
  return draft.finish(seq)
}
