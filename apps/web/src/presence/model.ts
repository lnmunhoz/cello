// Who made a task, who changed it last (CEL-5), who's on it right now and where it is inside In
// Progress (CEL-35), and which subagent of a session did it (CEL-55): read from board state, so the
// card, the list row, the task panel and the sidebar all say the same thing. Presence itself (active,
// idle, ended) is @cello/domain/presence.
import { agentPresence, agentPresenceSubject, workingAgents } from "@cello/client/sync/agents"
import type { BoardState } from "@cello/client/sync/applyEvents"
import { type AgentSession, agentKey, type SessionAgent, type Task } from "@cello/contract/entities"
import { type StageInfo, stageInfo } from "@cello/contract/stages"
import { isNeedsInputStatus } from "@cello/domain/ask"
import { colorFromSeed } from "@cello/domain/color"
import { modelName } from "@cello/domain/model"
import { agoShort, type Presence, presenceOf } from "@cello/domain/presence"
import { isReviewStatus, stageStatus } from "@cello/domain/review"
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
  /**
   * CEL-119: "main" for an agent session itself (the thread Lucas talks to), "subagent" for one it
   * started; absent for the human, and for an agent whose session the board doesn't have.
   */
  readonly role?: "main" | "subagent"
  /** What an author line leads with: the client for a session ("Claude Code"), the type for a subagent ("cello-builder"). */
  readonly label?: string
  /**
   * The model and effort as Claude Code names them ("claude-opus-5-5", "high"): what wrote a comment or
   * an event (whoOf), or what a session or subagent is on now (sessionWho, agentWho). Null when unknown.
   */
  readonly model?: string | null
  readonly effort?: string | null
}

/** What a comment or an event was written with (CEL-119); its keys are absent on ones stored before. */
export interface WrittenWith {
  readonly model?: string | null | undefined
  readonly effort?: string | null | undefined
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
  /** What the card, the row and the panel say: the stage, else Working while its agent is active (stepOf). */
  readonly step: StageInfo | null
}

const shortId = (s: AgentSession) => (s.externalId ?? s.id).slice(0, 8)

/** A session's colour: the same on every screen and after a reload. */
export const sessionColor = (s: AgentSession): string => colorFromSeed(s.externalId ?? s.id)

/** "Claude Code session 2fd0505c", the main session, on the model it's on now. */
export const sessionWho = (s: AgentSession): Who => ({
  kind: "agent",
  name: `${s.clientName} session ${shortId(s)}`,
  short: shortId(s),
  color: sessionColor(s),
  role: "main",
  label: s.clientName,
  model: s.model ?? null,
  effort: s.effort ?? null,
})

/** A subagent's colour: its own, so two builders of one session tell apart. */
export const agentColor = (a: Pick<SessionAgent, "agentId">): string => colorFromSeed(a.agentId)

/** "cello-builder · a13bfb89", under its session, on the model it's on now. */
export const agentWho = (
  a: Pick<SessionAgent, "agentId" | "agentType"> & Partial<Pick<SessionAgent, "model" | "effort">>,
  session: AgentSession | undefined,
): Who => {
  const name = `${a.agentType ?? "agent"} · ${a.agentId.slice(0, 8)}`
  return {
    kind: "agent",
    name,
    short: name,
    color: agentColor(a),
    ...(session ? { parent: sessionWho(session).name, parentShort: sessionWho(session).short } : {}),
    role: "subagent",
    label: a.agentType ?? "agent",
    model: a.model ?? null,
    effort: a.effort ?? null,
  }
}

export { agentPresence, agentPresenceSubject }

/**
 * The subagent when there is one (known to the board, or not yet: "agent · ffee0011"), else the session
 * when the board has it, else the actor ("Claude Code" for an agent, "Lucas" for the human). Its model is
 * what `written` says (a comment's or an event's, CEL-119), never the agent's current one: a comment keeps
 * the model it was written with, and something that doesn't say (a task's creator) shows none.
 */
export const whoOf = (board: BoardState, actorId: string, sessionId: string | null, agentId?: string | null, written?: WrittenWith): Who => {
  const session = sessionId === null ? undefined : board.sessions[sessionId]
  const model = { model: written?.model ?? null, effort: written?.effort ?? null }
  if (sessionId !== null && agentId) {
    return { ...agentWho(board.agents[agentKey(sessionId, agentId)] ?? { agentId, agentType: null }, session), ...model }
  }
  if (session) return { ...sessionWho(session), ...model }
  const actor = board.actors[actorId]
  const name = actor?.name ?? "Someone"
  const kind = actor?.kind ?? "human"
  return { kind, name, short: kind === "human" ? (name.split(" ")[0] ?? name) : name, color: actor?.color ?? "var(--faint)" }
}

/** One piece of an author line (CEL-119): the name, the role, the session, the model, the effort. */
export interface AuthorPart {
  readonly kind: "name" | "role" | "session" | "model" | "effort"
  readonly text: string
  /** The full name, for the hover. */
  readonly title?: string
}

/**
 * An author line, as the comments, the presence line and the Agents page show it (CEL-119):
 * "Claude Code · Main session · Opus 5.5 · high · 2fd0505c", "cello-builder · Subagent of 2fd0505c ·
 * Sonnet 5.5 · medium". No model, no model part: only the role. The human: the name alone.
 */
export const authorParts = (who: Who): ReadonlyArray<AuthorPart> => {
  const model: AuthorPart[] = who.model
    ? [{ kind: "model", text: modelName(who.model) }, ...(who.effort ? [{ kind: "effort" as const, text: who.effort }] : [])]
    : []
  if (who.role === "main") {
    return [{ kind: "name", text: who.label ?? who.name }, { kind: "role", text: "Main session" }, ...model, { kind: "session", text: who.short, title: who.name }]
  }
  if (who.role === "subagent") {
    return [
      { kind: "name", text: who.label ?? who.name, title: who.name },
      ...(who.parentShort ? [{ kind: "role" as const, text: "Subagent of " }, { kind: "session" as const, text: who.parentShort, title: who.parent ?? who.parentShort }] : [{ kind: "role" as const, text: "Subagent" }]),
      ...model,
    ]
  }
  return [{ kind: "name", text: who.name }]
}

/**
 * An author in one line of text, for the history and hovers (CEL-119): "Claude Code (Opus 5.5), main
 * session 2fd0505c", "cello-builder (Sonnet 5.5), subagent of 2fd0505c"; the human by name.
 */
export const whoText = (who: Who): string => {
  const model = who.model ? ` (${modelName(who.model)})` : ""
  if (who.role === "main") return `${who.label ?? who.name}${model}, main session ${who.short}`
  if (who.role === "subagent") return `${who.label ?? who.name}${model}, ${who.parentShort ? `subagent of ${who.parentShort}` : "subagent"}`
  return who.name
}

/**
 * An author as a history line names it (CEL-119): `subject` leads the line, its aside closed with a comma
 * ("cello-builder (Sonnet 5.5), subagent of 2fd0505c," set the stage…); `plain` is the full name for a
 * possessive or a wake ("Claude Code session 2fd0505c's comment…", "Cello woke Claude Code session 2fd0505c").
 */
export const whoSubject = (who: Who): { readonly subject: string; readonly plain: string } => ({
  subject: who.role ? `${whoText(who)},` : whoText(who),
  plain: who.name,
})

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
    step: stepOf(board, task, now),
  }
}

/**
 * Where a task with no stage goes while its agent is active (CEL-105): a session working by itself may
 * never set one, and "No stage" made its task look stuck. Not a stage: nobody sets it, the board works it
 * out, so the board stays truthful when an agent forgets.
 */
export const WORKING_LANE = "working"

export const WORKING: StageInfo = { id: WORKING_LANE, label: "Working", icon: "activity", color: "var(--muted)", when: "an agent is on it and hasn't set a stage" }

/**
 * Whether an agent on the task is active right now (CEL-105): the subagent working on it, else the agent
 * session holding its claim. Lucas has no presence, so a task he holds is never active this way.
 */
export const holderActive = (board: BoardState, task: Task, now: number): boolean => {
  if (agentOn(board, task, now) !== null) return true
  const session = task.assigneeSessionId === null ? undefined : board.sessions[task.assigneeSessionId]
  return session !== undefined && presenceOf(session, now) === "active"
}

/** Whether the task is in its workspace's In Progress (its first started status), where stages live. */
const inStageStatus = (board: BoardState, task: Task): boolean => {
  const status = board.statuses[task.statusId]
  if (!status) return false
  return stageStatus(Object.values(board.statuses).filter((s) => s.workspaceId === status.workspaceId))?.id === status.id
}

/**
 * Whether a task with no stage counts as Working: in In Progress with an agent on it active. Elsewhere it
 * doesn't: waiting in Needs input, its session stays active (`cello task ask --wait`), but it's waiting.
 */
export const workingNow = (board: BoardState, task: Task, now: number): boolean => inStageStatus(board, task) && holderActive(board, task, now)

/** The step a task is at: its stage (wherever it's carried), else Working (workingNow), else none. */
export const stepOf = (board: BoardState, task: Task, now: number): StageInfo | null =>
  task.stage !== null ? (stageInfo(task.stage) ?? null) : workingNow(board, task, now) ? WORKING : null

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
  /** Its subagents still working (active or quiet, not stopped), in the order they started (CEL-186). */
  readonly agents: ReadonlyArray<WorkingAgent>
  /** Its mark: from the tasks whose cards show the session itself, not a subagent of it. */
  readonly mark: WorkingMark
}

/**
 * The agent sessions working in a workspace, in the order they started (workingAgents, shared with `cello agents`),
 * each with who it is and its mark, and its subagents' too.
 */
export const workingSessions = (board: BoardState, workspaceId: string, now: number): Working[] =>
  workingAgents(board, workspaceId, now).map(({ session, presence, tasks, agents }) => ({
    session,
    who: sessionWho(session),
    presence,
    tasks,
    agents: agents.map(({ agent, presence, task }) => ({
      agent,
      who: agentWho(agent, board.sessions[agent.sessionId]),
      presence,
      task,
      mark: workingMark(board, task ? [task] : [], presence),
    })),
    // The session's cards: those with no subagent working on them (agentOn names the subagent instead).
    mark: workingMark(board, tasks.filter((t) => agentOn(board, t, now) === null), presence),
  }))

/** "Agents working N": each active session, and each active subagent under it. */
export const agentsWorkingCount = (working: ReadonlyArray<Working>): number =>
  working.reduce((n, w) => n + (w.presence === "active" ? 1 : 0) + w.agents.filter((a) => a.presence === "active").length, 0)

/** One agent session working in a project (CEL-179), with the tasks it's on there. */
export interface ProjectWorking {
  readonly working: Working
  readonly tasks: ReadonlyArray<Task>
}

/**
 * The agent sessions working in each project, by project id, for the badge on each sidebar project row
 * (CEL-179). It reads the same list as "Agents working" (workingSessions), by the same rule: a session
 * counts where it is active and holds a claim, and where one of its subagents is active on a task. A
 * session counts once in a project however many tasks or subagents it has there, and in each project
 * it works in. So a project's number is sessions, never subagents: the workspace's number, which adds
 * each active subagent, is at least their sum, and equal only with no subagents and no session in two
 * projects. A project with nobody working has no entry.
 */
export const agentsWorkingByProject = (working: ReadonlyArray<Working>): Map<string, ProjectWorking[]> => {
  const byProject = new Map<string, ProjectWorking[]>()
  for (const w of working) {
    const tasksIn = new Map<string, Map<string, Task>>()
    const add = (task: Task) => {
      const tasks = tasksIn.get(task.projectId) ?? new Map<string, Task>()
      tasks.set(task.id, task)
      tasksIn.set(task.projectId, tasks)
    }
    if (w.presence === "active") w.tasks.forEach(add)
    for (const a of w.agents) if (a.presence === "active" && a.task) add(a.task)
    for (const [projectId, tasks] of tasksIn) byProject.set(projectId, [...(byProject.get(projectId) ?? []), { working: w, tasks: [...tasks.values()] }])
  }
  return byProject
}

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
  // Approved and waiting for its merge (CEL-143): its agent is still at work, so the mood follows the stage.
  if ((isReviewStatus(status.name) && stage === null) || status.category === "completed") return "done"
  if (presence !== "active") return "still"
  if (stage === "building" || stage === "fixing" || stage === "merging") return "working"
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
