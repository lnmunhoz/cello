// Who made a task, who changed it last (CEL-5), who's on it right now and where it is inside In
// Progress (CEL-35): read from board state, so the card, the list row, the task panel and the sidebar
// all say the same thing. Presence itself (active, idle, ended) is @cello/shared/presence.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, Task } from "@cello/contract/entities"
import { type StageInfo, stageInfo } from "@cello/contract/stages"
import { colorFromSeed } from "@cello/shared/color"
import { agoShort, type Presence, presenceOf } from "@cello/shared/presence"
import { formatDay } from "../lib/format.ts"

/** A person or an agent session, as the board names it. */
export interface Who {
  readonly kind: "human" | "agent"
  /** "Lucas N. Munhoz", "Claude Code session 8a41c9e2". */
  readonly name: string
  /** "Lucas", "8a41c9e2": what a card has room for. */
  readonly short: string
  readonly color: string
}

/** Who holds the claim: an agent session (with its presence), or Lucas (no session, no presence). */
export interface Holder {
  readonly who: Who
  readonly session: AgentSession | null
}

export interface Provenance {
  readonly createdBy: Who
  readonly createdAt: number
  /** Null until someone changes the task (or comments on it) after creating it. */
  readonly changedBy: Who | null
  readonly changedAt: number
  /** "commented" when the latest activity was a comment (added or edited), else "changed". */
  readonly changeVerb: "changed" | "commented"
  readonly holder: Holder | null
  readonly stage: StageInfo | null
}

const shortId = (s: AgentSession) => (s.externalId ?? s.id).slice(0, 8)

/** A session's colour: the same on every screen and after a reload. */
export const sessionColor = (s: AgentSession): string => colorFromSeed(s.externalId ?? s.id)

export const sessionWho = (s: AgentSession): Who => ({
  kind: "agent",
  name: `${s.clientName} session ${shortId(s)}`,
  short: shortId(s),
  color: sessionColor(s),
})

/** The session when the board has it, else the actor ("Claude Code" for an agent, "Lucas" for the human). */
export const whoOf = (board: BoardState, actorId: string, sessionId: string | null): Who => {
  const session = sessionId === null ? undefined : board.sessions[sessionId]
  if (session) return sessionWho(session)
  const actor = board.actors[actorId]
  const name = actor?.name ?? "Someone"
  const kind = actor?.kind ?? "human"
  return { kind, name, short: kind === "human" ? (name.split(" ")[0] ?? name) : name, color: actor?.color ?? "var(--faint)" }
}

export const provenanceOf = (board: BoardState, task: Task): Provenance => {
  const changed = task.version > 1 && task.updatedByActorId !== null
  const session = task.assigneeSessionId === null ? null : (board.sessions[task.assigneeSessionId] ?? null)
  return {
    createdBy: whoOf(board, task.createdByActorId, task.createdBySessionId),
    createdAt: task.createdAt,
    changedBy: changed ? whoOf(board, task.updatedByActorId!, task.updatedBySessionId) : null,
    changedAt: task.updatedAt,
    changeVerb: task.lastCommentAt !== null && task.lastCommentAt >= task.updatedAt ? "commented" : "changed",
    holder: task.assigneeActorId === null
      ? null
      : { who: session ? sessionWho(session) : whoOf(board, task.assigneeActorId, task.assigneeSessionId), session },
    stage: task.stage === null ? null : (stageInfo(task.stage) ?? null),
  }
}

/**
 * "Lucas created · 8a41c9e2 changed 4m ago", "Lucas created · 2fd0505c commented just now",
 * "Lucas created · changed 2h ago", "Lucas created Nov 14".
 */
export const provenanceLine = (p: Provenance, now: number): string => {
  if (p.changedBy === null) return `${p.createdBy.short} created ${formatDay(p.createdAt, now)}`
  const by = p.changedBy.name === p.createdBy.name ? "" : `${p.changedBy.short} `
  return `${p.createdBy.short} created · ${by}${p.changeVerb} ${agoShort(p.changedAt, now)}`
}

export interface Working {
  readonly session: AgentSession
  readonly who: Who
  readonly presence: Presence
  readonly tasks: ReadonlyArray<Task>
}

const ORDER: Record<Presence, number> = { active: 0, idle: 1, ended: 2 }

/** The agent sessions holding claims in a workspace, active first, each with the tasks it holds. */
export const workingSessions = (board: BoardState, workspaceId: string, now: number): Working[] => {
  const bySession = new Map<string, Task[]>()
  for (const task of Object.values(board.tasks)) {
    if (task.archivedAt !== null || task.assigneeSessionId === null) continue
    if (board.projects[task.projectId]?.workspaceId !== workspaceId) continue
    bySession.set(task.assigneeSessionId, [...(bySession.get(task.assigneeSessionId) ?? []), task])
  }
  return [...bySession.entries()]
    .flatMap(([id, tasks]) => {
      const session = board.sessions[id]
      return session ? [{ session, who: sessionWho(session), presence: presenceOf(session, now), tasks }] : []
    })
    .sort((a, b) => ORDER[a.presence] - ORDER[b.presence] || b.session.lastSeenAt - a.session.lastSeenAt)
}
