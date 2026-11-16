// Who made a task, who changed it last (CEL-5), who's on it right now and where it is inside In
// Progress (CEL-35), and which subagent of a session did it (CEL-55): read from board state, so the
// card, the list row, the task panel and the sidebar all say the same thing. Presence itself (active,
// idle, ended) is @cello/shared/presence.
import type { BoardState } from "@cello/client/sync/applyEvents"
import { type AgentSession, agentKey, type SessionAgent, type Task } from "@cello/contract/entities"
import { type StageInfo, stageInfo } from "@cello/contract/stages"
import { isNeedsInputStatus } from "@cello/shared/ask"
import { colorFromSeed } from "@cello/shared/color"
import { agoShort, type Presence, presenceOf, type SessionLike } from "@cello/shared/presence"
import { isReviewStatus } from "@cello/shared/review"
import type { AgentMood } from "../components/ui/AgentMark.tsx"
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

/** A sidebar entry's agent mark (CEL-55): the mood its card shows, and that task's status ("" with none). */
export interface WorkingMark {
  readonly mood: AgentMood
  readonly statusId: string
}

/** A subagent working under a session, for the sidebar: who, whether it's working, its task and its mark. */
export interface WorkingAgent {
  readonly agent: SessionAgent
  readonly who: Who
  readonly presence: Presence
  readonly task: Task | null
  readonly mark: WorkingMark
}

export interface Working {
  readonly session: AgentSession
  readonly who: Who
  readonly presence: Presence
  /** The tasks the session holds. */
  readonly tasks: ReadonlyArray<Task>
  /** Its subagents still working (active or quiet, not stopped), the freshest first (CEL-55). */
  readonly agents: ReadonlyArray<WorkingAgent>
  /** Its mark: from the tasks whose cards show the session itself, not a subagent of it. */
  readonly mark: WorkingMark
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
    const mark = workingMark(board, task ? [task] : [], presence)
    list.push({ agent, who: agentWho(agent, board.sessions[agent.sessionId]), presence, task: task ?? null, mark })
    agentsBySession.set(agent.sessionId, list)
  }
  const ids = new Set([...bySession.keys(), ...[...agentsBySession.entries()].filter(([, list]) => list.some((a) => a.task)).map(([id]) => id)])
  return [...ids]
    .flatMap((id) => {
      const session = board.sessions[id]
      if (!session) return []
      const agents = (agentsBySession.get(id) ?? [])
        .sort((a, b) => ORDER[a.presence] - ORDER[b.presence] || b.agent.lastSeenAt - a.agent.lastSeenAt)
      const tasks = bySession.get(id) ?? []
      const presence = presenceOf(session, now)
      // The session's cards: those with no subagent working on them (agentOn names the subagent instead).
      const mark = workingMark(board, tasks.filter((t) => agentOn(board, t, now) === null), presence)
      return [{ session, who: sessionWho(session), presence, tasks, agents, mark }]
    })
    .sort((a, b) => ORDER[a.presence] - ORDER[b.presence] || b.session.lastSeenAt - a.session.lastSeenAt)
}

/** "Agents working N": each active session, and each active subagent under it. */
export const agentsWorkingCount = (working: ReadonlyArray<Working>): number =>
  working.reduce((n, w) => n + (w.presence === "active" ? 1 : 0) + w.agents.filter((a) => a.presence === "active").length, 0)

/**
 * What the agent mark on a card shows (CEL-69). The task's status speaks first: waiting on Lucas in
 * Needs input, done once it's In Review or Done. Otherwise its holder (the subagent on it, else the
 * session): working while it builds or fixes findings, thinking with no stage yet or in Agent review,
 * happy and still once merged. Working and thinking loop, so they're given only while the holder is
 * active (checked in within ACTIVE_MS); a quiet or ended holder keeps still, so an idle board runs none.
 */
export const agentMood = (
  stage: string | null,
  status: { readonly name: string; readonly category: string } | undefined,
  presence: Presence,
): AgentMood => {
  if (status === undefined || status.category === "canceled") return "still"
  if (isNeedsInputStatus(status)) return "waiting"
  if (isReviewStatus(status.name) || status.category === "completed") return "done"
  if (presence !== "active") return "still"
  if (stage === "building" || stage === "fixing") return "working"
  if (stage === "merged") return "merged"
  return "thinking"
}

/** Which of several tasks' moods a sidebar entry shows: what Lucas most needs to see comes first. */
const MOOD_FIRST: Record<AgentMood, number> = { waiting: 0, working: 1, thinking: 2, merged: 3, done: 4, still: 5 }

/**
 * A sidebar entry's mark (CEL-55): the mood the card of the task it's on shows (agentMood), with that
 * task's status. A session on several picks the one Lucas most needs to see: waiting on him, then
 * working, thinking, merged, done. On none (a lookup, or an orchestrator whose tasks all have a subagent
 * on them), it thinks while active and keeps still once quiet.
 */
export const workingMark = (board: BoardState, tasks: ReadonlyArray<Task>, presence: Presence): WorkingMark => {
  let best: WorkingMark | null = null
  for (const task of tasks) {
    const mood = agentMood(task.stage, board.statuses[task.statusId], presence)
    if (best === null || MOOD_FIRST[mood] < MOOD_FIRST[best.mood]) best = { mood, statusId: task.statusId }
  }
  return best ?? { mood: presence === "active" ? "thinking" : "still", statusId: "" }
}

/** A mark as it was drawn: its mood and the task's status. */
export interface MarkSeen {
  readonly mood: AgentMood
  readonly statusId: string
}

/**
 * What plays once when a card changes while it's on screen: Done when the task moves into In Review or
 * Done (In Review to Done included), the Needs input hop when it starts waiting; else nothing. Working
 * and thinking have no entry: they loop by their mood, page load included, while the agent is active.
 */
export const markEntry = (before: MarkSeen, now: MarkSeen): "done" | "waiting" | null => {
  if (now.mood === "done" && (before.mood !== "done" || before.statusId !== now.statusId)) return "done"
  if (now.mood === "waiting" && before.mood !== "waiting") return "waiting"
  return null
}
