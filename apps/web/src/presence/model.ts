// Who made a task, who changed it last (CEL-5), who's on it right now and where it is inside In
// Progress (CEL-35), and which subagent of a session did it (CEL-55): read from board state, so the
// card, the list row, the task panel and the sidebar all say the same thing. Presence itself (active,
// idle, ended) is @cello/shared/presence.
import type { BoardState } from "@cello/client/sync/applyEvents"
import { type AgentSession, agentKey, type SessionAgent, type Task } from "@cello/contract/entities"
import { type StageInfo, stageInfo } from "@cello/contract/stages"
import { colorFromSeed } from "@cello/shared/color"
import { agoShort, type Presence, presenceOf, type SessionLike } from "@cello/shared/presence"
import { formatDay } from "../lib/format.ts"

/** A person, an agent session, or a session's subagent, as the board names it. */
export interface Who {
  readonly kind: "human" | "agent"
  /** "Lucas N. Munhoz", "Claude Code session 8a41c9e2", "cello-builder · a13bfb89". */
  readonly name: string
  /** "Lucas", "8a41c9e2", "cello-builder · a13bfb89": what a card has room for. */
  readonly short: string
  readonly color: string
  /** A subagent's session, by name ("Claude Code session 2fd0505c"): shown on hover and in the panel. */
  readonly parent?: string
  /** The same, short ("2fd0505c"): what a line has room for after the agent's name. */
  readonly parentShort?: string
}

/**
 * Who is on a task: a subagent working on it (with its session), else the claim's agent session, else
 * Lucas (no session, no presence). `agent` and `session` say whose presence the dot shows.
 */
export interface Holder {
  readonly who: Who
  readonly session: AgentSession | null
  readonly agent: SessionAgent | null
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

/** A subagent's colour: its own, so two builders of one session tell apart. */
export const agentColor = (a: Pick<SessionAgent, "agentId">): string => colorFromSeed(a.agentId)

/** "cello-builder · a13bfb89", under its session. */
export const agentWho = (a: Pick<SessionAgent, "agentId" | "agentType">, session: AgentSession | undefined): Who => {
  const name = `${a.agentType ?? "agent"} · ${a.agentId.slice(0, 8)}`
  return {
    kind: "agent",
    name,
    short: name,
    color: agentColor(a),
    ...(session ? { parent: sessionWho(session).name, parentShort: sessionWho(session).short } : {}),
  }
}

/** An agent's presence: its own, but ended once its session ended (the conversation is gone). */
export const agentPresence = (board: BoardState, a: SessionAgent, now: number): Presence =>
  board.sessions[a.sessionId]?.endedAt != null ? "ended" : presenceOf(a, now)

/** What a presence dot and its words read: the agent's times, ended with its session. */
export const agentPresenceSubject = (board: BoardState, a: SessionAgent): SessionLike => {
  const ended = board.sessions[a.sessionId]?.endedAt
  return ended != null && a.endedAt === null ? { lastSeenAt: a.lastSeenAt, endedAt: ended } : a
}

/**
 * The subagent when there is one (known to the board, or not yet: "agent · ffee0011"), else the session
 * when the board has it, else the actor ("Claude Code" for an agent, "Lucas" for the human).
 */
export const whoOf = (board: BoardState, actorId: string, sessionId: string | null, agentId?: string | null): Who => {
  const session = sessionId === null ? undefined : board.sessions[sessionId]
  if (sessionId !== null && agentId) {
    return agentWho(board.agents[agentKey(sessionId, agentId)] ?? { agentId, agentType: null }, session)
  }
  if (session) return sessionWho(session)
  const actor = board.actors[actorId]
  const name = actor?.name ?? "Someone"
  const kind = actor?.kind ?? "human"
  return { kind, name, short: kind === "human" ? (name.split(" ")[0] ?? name) : name, color: actor?.color ?? "var(--faint)" }
}

/** The subagent working on a task right now: the freshest active one on it, of any session. */
export const agentOn = (board: BoardState, task: Task, now: number): SessionAgent | null => {
  let best: SessionAgent | null = null
  for (const a of Object.values(board.agents)) {
    if (a.taskId !== task.id || agentPresence(board, a, now) !== "active") continue
    if (best === null || a.lastSeenAt > best.lastSeenAt) best = a
  }
  return best
}

export const provenanceOf = (board: BoardState, task: Task, now: number = Date.now()): Provenance => {
  const changed = task.version > 1 && task.updatedByActorId !== null
  const session = task.assigneeSessionId === null ? null : (board.sessions[task.assigneeSessionId] ?? null)
  const agent = agentOn(board, task, now)
  const agentSession = agent ? (board.sessions[agent.sessionId] ?? null) : null
  return {
    createdBy: whoOf(board, task.createdByActorId, task.createdBySessionId),
    createdAt: task.createdAt,
    changedBy: changed ? whoOf(board, task.updatedByActorId!, task.updatedBySessionId, task.updatedByAgentId) : null,
    changedAt: task.updatedAt,
    changeVerb: task.lastCommentAt !== null && task.lastCommentAt >= task.updatedAt ? "commented" : "changed",
    holder: agent
      ? { who: agentWho(agent, agentSession ?? undefined), session: agentSession, agent }
      : task.assigneeActorId === null
      ? null
      : { who: session ? sessionWho(session) : whoOf(board, task.assigneeActorId, task.assigneeSessionId), session, agent: null },
    stage: task.stage === null ? null : (stageInfo(task.stage) ?? null),
  }
}

/**
 * "Lucas created · 8a41c9e2 changed 4m ago", "Lucas created · 2fd0505c commented just now",
 * "Lucas created · cello-builder · a13bfb89 changed 4m ago", "Lucas created · changed 2h ago", "Lucas created Nov 14".
 */
export const provenanceLine = (p: Provenance, now: number): string => {
  if (p.changedBy === null) return `${p.createdBy.short} created ${formatDay(p.createdAt, now)}`
  const by = p.changedBy.name === p.createdBy.name ? "" : `${p.changedBy.short} `
  return `${p.createdBy.short} created · ${by}${p.changeVerb} ${agoShort(p.changedAt, now)}`
}

/** A subagent working under a session, for the sidebar: who, whether it's working, and its task. */
export interface WorkingAgent {
  readonly agent: SessionAgent
  readonly who: Who
  readonly presence: Presence
  readonly task: Task | null
}

export interface Working {
  readonly session: AgentSession
  readonly who: Who
  readonly presence: Presence
  /** The tasks the session holds. */
  readonly tasks: ReadonlyArray<Task>
  /** Its subagents still working (active or quiet, not stopped), the freshest first (CEL-55). */
  readonly agents: ReadonlyArray<WorkingAgent>
}

const ORDER: Record<Presence, number> = { active: 0, idle: 1, ended: 2 }

/**
 * The agent sessions working in a workspace, active first: the ones holding claims there and the ones
 * with a subagent on a task there, each with the tasks it holds and its subagents still working.
 */
export const workingSessions = (board: BoardState, workspaceId: string, now: number): Working[] => {
  const inWorkspace = (task: Task | undefined): task is Task =>
    task !== undefined && task.archivedAt === null && board.projects[task.projectId]?.workspaceId === workspaceId
  const bySession = new Map<string, Task[]>()
  for (const task of Object.values(board.tasks)) {
    if (task.assigneeSessionId === null || !inWorkspace(task)) continue
    bySession.set(task.assigneeSessionId, [...(bySession.get(task.assigneeSessionId) ?? []), task])
  }
  const agentsBySession = new Map<string, WorkingAgent[]>()
  for (const agent of Object.values(board.agents)) {
    const presence = agentPresence(board, agent, now)
    if (presence === "ended") continue
    const task = agent.taskId === null ? undefined : board.tasks[agent.taskId]
    // An agent on a task elsewhere belongs to that workspace's list; one with no task, to its session's.
    if (agent.taskId !== null && !inWorkspace(task)) continue
    const list = agentsBySession.get(agent.sessionId) ?? []
    list.push({ agent, who: agentWho(agent, board.sessions[agent.sessionId]), presence, task: task ?? null })
    agentsBySession.set(agent.sessionId, list)
  }
  const ids = new Set([...bySession.keys(), ...[...agentsBySession.entries()].filter(([, list]) => list.some((a) => a.task)).map(([id]) => id)])
  return [...ids]
    .flatMap((id) => {
      const session = board.sessions[id]
      if (!session) return []
      const agents = (agentsBySession.get(id) ?? [])
        .sort((a, b) => ORDER[a.presence] - ORDER[b.presence] || b.agent.lastSeenAt - a.agent.lastSeenAt)
      return [{ session, who: sessionWho(session), presence: presenceOf(session, now), tasks: bySession.get(id) ?? [], agents }]
    })
    .sort((a, b) => ORDER[a.presence] - ORDER[b.presence] || b.session.lastSeenAt - a.session.lastSeenAt)
}

/** "Agents working N": each active session, and each active subagent under it. */
export const agentsWorkingCount = (working: ReadonlyArray<Working>): number =>
  working.reduce((n, w) => n + (w.presence === "active" ? 1 : 0) + w.agents.filter((a) => a.presence === "active").length, 0)
