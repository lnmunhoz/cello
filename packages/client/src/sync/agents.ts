// Which agents work in a workspace, and which finished today (CEL-65, CEL-107): read from board state,
// so the Agents page, the sidebar and `cello agents` list the same agents. Presence itself (active,
// idle, ended) is @cello/domain/presence; who and how each looks on screen stays with the web app.
import type { AgentSession, SessionAgent, Task } from "@cello/contract/entities"
import { type Presence, presenceOf, type SessionLike } from "@cello/domain/presence"
import type { BoardState } from "./applyEvents.ts"

/** An agent's presence: its own, but ended once its session ended (the conversation is gone). */
export const agentPresence = (board: BoardState, a: SessionAgent, now: number): Presence =>
  board.sessions[a.sessionId]?.endedAt != null ? "ended" : presenceOf(a, now)

/** What a presence dot and its words read: the agent's times, ended with its session. */
export const agentPresenceSubject = (board: BoardState, a: SessionAgent): SessionLike => {
  const ended = board.sessions[a.sessionId]?.endedAt
  return ended != null && a.endedAt === null ? { lastSeenAt: a.lastSeenAt, endedAt: ended } : a
}

/** A subagent working under a session: whether it's working, and its task. */
export interface WorkingAgentOf {
  readonly agent: SessionAgent
  readonly presence: Presence
  readonly task: Task | null
}

export interface WorkingSessionOf {
  readonly session: AgentSession
  readonly presence: Presence
  /** The tasks the session holds. */
  readonly tasks: ReadonlyArray<Task>
  /** Its subagents still working (active or quiet, not stopped), the freshest first (CEL-55). */
  readonly agents: ReadonlyArray<WorkingAgentOf>
}

const ORDER: Record<Presence, number> = { active: 0, idle: 1, ended: 2 }

const inWorkspaceOf = (board: BoardState, workspaceId: string) => (task: Task | undefined): task is Task =>
  task !== undefined && task.archivedAt === null && board.projects[task.projectId]?.workspaceId === workspaceId

/** The tasks each session holds a claim on in the workspace, by session id. */
const claimsBySession = (board: BoardState, workspaceId: string): Map<string, Task[]> => {
  const inWorkspace = inWorkspaceOf(board, workspaceId)
  const bySession = new Map<string, Task[]>()
  for (const task of Object.values(board.tasks)) {
    if (task.assigneeSessionId === null || !inWorkspace(task)) continue
    bySession.set(task.assigneeSessionId, [...(bySession.get(task.assigneeSessionId) ?? []), task])
  }
  return bySession
}

/**
 * The agent sessions working in a workspace, active first: the ones holding claims there and the ones
 * with a subagent on a task there, each with the tasks it holds and its subagents still working. A
 * session that ended is still here (its claims stay); callers that list who's working leave it out.
 */
export const workingAgents = (board: BoardState, workspaceId: string, now: number): WorkingSessionOf[] => {
  const inWorkspace = inWorkspaceOf(board, workspaceId)
  const bySession = claimsBySession(board, workspaceId)
  const agentsBySession = new Map<string, WorkingAgentOf[]>()
  for (const agent of Object.values(board.agents)) {
    const presence = agentPresence(board, agent, now)
    if (presence === "ended") continue
    const task = agent.taskId === null ? undefined : board.tasks[agent.taskId]
    // An agent on a task elsewhere belongs to that workspace's list; one with no task, to its session's.
    if (agent.taskId !== null && !inWorkspace(task)) continue
    const list = agentsBySession.get(agent.sessionId) ?? []
    list.push({ agent, presence, task: task ?? null })
    agentsBySession.set(agent.sessionId, list)
  }
  const ids = new Set([...bySession.keys(), ...[...agentsBySession.entries()].filter(([, list]) => list.some((a) => a.task)).map(([id]) => id)])
  return [...ids]
    .flatMap((id) => {
      const session = board.sessions[id]
      if (!session) return []
      const agents = (agentsBySession.get(id) ?? [])
        .sort((a, b) => ORDER[a.presence] - ORDER[b.presence] || b.agent.lastSeenAt - a.agent.lastSeenAt)
      return [{ session, presence: presenceOf(session, now), tasks: bySession.get(id) ?? [], agents }]
    })
    .sort((a, b) => ORDER[a.presence] - ORDER[b.presence] || b.session.lastSeenAt - a.session.lastSeenAt)
}

/** An agent session or subagent that finished: when, and the tasks it was on. */
export interface FinishedAgent {
  readonly session: AgentSession
  /** The subagent; null for the session itself. */
  readonly agent: SessionAgent | null
  /** When it ended: a subagent's own stop, else its session's end. */
  readonly endedAt: number
  /** A session's: the ones it holds; a subagent's: the one its launch named. */
  readonly tasks: ReadonlyArray<Task>
}

/** Local midnight before `now`: where "today" starts for Finished today. */
export const startOfDay = (now: number): number => {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/**
 * The agents of a workspace that finished since `since` (startOfDay, for Finished today), newest first:
 * the sessions that held claims there or had a subagent on a task there, and the subagents on its tasks
 * (or with no task, under such a session). A subagent ends with its session when it never stopped itself.
 */
export const finishedAgents = (board: BoardState, workspaceId: string, since: number): FinishedAgent[] => {
  const inWorkspace = inWorkspaceOf(board, workspaceId)
  const claims = claimsBySession(board, workspaceId)
  const onTask = new Set(Object.values(board.agents).filter((a) => a.taskId !== null && inWorkspace(board.tasks[a.taskId])).map((a) => a.sessionId))
  const belongs = (sessionId: string) => claims.has(sessionId) || onTask.has(sessionId)
  const found: FinishedAgent[] = []
  for (const session of Object.values(board.sessions)) {
    if (session.endedAt === null || session.endedAt < since || !belongs(session.id)) continue
    found.push({ session, agent: null, endedAt: session.endedAt, tasks: claims.get(session.id) ?? [] })
  }
  for (const agent of Object.values(board.agents)) {
    const session = board.sessions[agent.sessionId]
    const endedAt = session ? agentPresenceSubject(board, agent).endedAt : agent.endedAt
    if (!session || endedAt === null || endedAt < since) continue
    const task = agent.taskId === null ? undefined : board.tasks[agent.taskId]
    if (agent.taskId === null ? !belongs(agent.sessionId) : !inWorkspace(task)) continue
    found.push({ session, agent, endedAt, tasks: task ? [task] : [] })
  }
  return found.sort((a, b) => b.endedAt - a.endedAt || (a.agent === null ? -1 : 0) - (b.agent === null ? -1 : 0))
}
