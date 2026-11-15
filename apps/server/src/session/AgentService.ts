// Subagents under an agent session (CEL-55). Claude Code runs builders and reviewers with their parent's
// session id, so the session alone can't say who is working. Its hooks name each subagent (`agent_id`,
// `agent_type`), and a CLI call can carry it (`x-cello-agent`, from CELLO_AGENT): each becomes a
// `session_agents` row under its session, created on first sight (SessionService.resolve).
//
// - The task: the parent's Agent tool launch (`report` "launched") names it; the first task key in the
//   launch's description, else its prompt, that is a real task.
// - Presence, like sessions (CEL-35): boards hear an agent check in (`agent.seen`, at most once every
//   PRESENCE_EVERY_MS per workspace) and hear at once when it starts, is launched or stops. The
//   workspace is its task's, else the ones its session holds claims in.
// - Claims and inbox delivery stay on the session (CEL-15): nothing here touches them.
import type { SessionAgent } from "@cello/contract/entities"
import { type AgentReportState, Caller } from "@cello/contract/rpcs"
import { parseTaskKey, taskKeysIn } from "@cello/shared/taskKey"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import { cleanAgentText, MAX_AGENT_TEXT, PRESENCE_EVERY_MS, touchAgent } from "./SessionService.ts"

/** What a hook says happened to a subagent of the caller's session. */
export interface AgentReport {
  readonly agentId: string
  readonly agentType: string | null
  readonly state: AgentReportState
  readonly description?: string | undefined
  readonly prompt?: string | undefined
}

/** One agent, by its session and host id. */
export interface AgentRef {
  readonly sessionId: string
  readonly agentId: string
}

/** How long a quiet agent that never stopped still comes with a board, so the sidebar can list it. */
export const LIVE_AGENT_MS = 24 * 60 * 60 * 1000

interface AgentRow {
  session_id: string
  agent_id: string
  agent_type: string | null
  task_id: string | null
  description: string | null
  started_at: number
  last_seen_at: number
  ended_at: number | null
}

export const toAgent = (r: AgentRow): SessionAgent => ({
  sessionId: r.session_id,
  agentId: r.agent_id,
  agentType: r.agent_type,
  taskId: r.task_id,
  description: r.description,
  startedAt: r.started_at,
  lastSeenAt: r.last_seen_at,
  endedAt: r.ended_at,
})

export class AgentService extends Context.Service<AgentService, {
  /** What a hook saw (SubagentStart, the Agent tool's launch, SubagentStop), for the caller's session. Null for the human or an unknown stop. */
  readonly report: (input: AgentReport) => Effect.Effect<SessionAgent | null, never, Caller>
  /** After an agent's request: boards hear it's working, unless they heard within PRESENCE_EVERY_MS. Others: nothing. */
  readonly checkIn: (caller: Caller["Service"]) => Effect.Effect<void>
  /** Agents by session and id; unknown ones are left out. */
  readonly byRefs: (refs: ReadonlyArray<AgentRef>) => Effect.Effect<ReadonlyArray<SessionAgent>>
  /**
   * What a board needs: the agents on these tasks, and the live ones (not stopped, seen within
   * LIVE_AGENT_MS) of these sessions. Oldest first.
   */
  readonly forBoard: (taskIds: ReadonlyArray<string>, sessionIds: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<SessionAgent>>
}>()("cello/AgentService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands
  /** When each `<session> <agent> <workspace>` last got an agent.seen. In memory: a restart sends one again. */
  const heard = new Map<string, number>()

  const load = (ref: AgentRef) =>
    sql<AgentRow>`SELECT * FROM session_agents WHERE session_id = ${ref.sessionId} AND agent_id = ${ref.agentId}`.pipe(
      Effect.map((rows) => (rows[0] ? toAgent(rows[0]) : null)),
    )

  /** The first task the text names, by key, that exists. */
  const taskNamed = (texts: ReadonlyArray<string | undefined>) =>
    Effect.gen(function* () {
      for (const key of texts.flatMap((t) => (t ? taskKeysIn(t) : []))) {
        const parsed = parseTaskKey(key)!
        const rows = yield* sql<{ id: string }>`
          SELECT t.id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.key = ${parsed.projectKey} AND t.number = ${parsed.number}`
        if (rows[0]) return rows[0].id
      }
      return null
    })

  /** Where boards hear about an agent: its task's workspace, else those its session holds claims in. */
  const workspacesOf = (agent: SessionAgent) =>
    agent.taskId !== null
      ? sql<{ workspace_id: string }>`
          SELECT p.workspace_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ${agent.taskId}`
          .pipe(Effect.map((rows) => rows.map((r) => r.workspace_id)))
      : sql<{ workspace_id: string }>`
          SELECT DISTINCT p.workspace_id FROM tasks t JOIN projects p ON p.id = t.project_id
          WHERE t.assignee_session_id = ${agent.sessionId} AND t.archived_at IS NULL`
          .pipe(Effect.map((rows) => rows.map((r) => r.workspace_id)))

  const heardKey = (agent: SessionAgent, workspaceId: string) => `${agent.sessionId} ${agent.agentId} ${workspaceId}`

  /** One agent.seen per workspace, as the agent itself, with no receipt (nobody retries it). */
  const tell = (agent: SessionAgent, workspaceIds: ReadonlyArray<string>, now: number) =>
    Effect.gen(function* () {
      if (workspaceIds.length === 0) return
      // Marked before the write, so parallel calls (the hook on parallel tool calls) send it once.
      for (const w of workspaceIds) heard.set(heardKey(agent, w), now)
      const actor = yield* sql<{ actor_id: string }>`SELECT actor_id FROM agent_sessions WHERE id = ${agent.sessionId}`
      if (!actor[0]) return
      yield* commands.write({ commandId: crypto.randomUUID(), rpc: "agent.seen", receipt: false }, ({ emit }) =>
        Effect.forEach(workspaceIds, (workspaceId) => emit({ type: "agent.seen", agent }, { workspaceId, projectId: null }), { discard: true }))
        .pipe(Effect.provideService(Caller, { actorId: actor[0].actor_id, sessionId: agent.sessionId, agentId: agent.agentId }))
    })

  const report = Effect.fn("AgentService.report")(function* (input: AgentReport) {
    const caller = yield* Caller
    const agentId = cleanAgentText(input.agentId)
    if (caller.sessionId === null || agentId === null) return null
    const agentType = cleanAgentText(input.agentType)
    const now = yield* Clock.currentTimeMillis
    const ref = { sessionId: caller.sessionId, agentId }
    if (input.state === "stopped") {
      // Claude Code's own helpers (prompt suggestions, /btw) stop without ever starting here: not recorded.
      const updated = yield* sql`UPDATE session_agents SET ended_at = ${now} WHERE session_id = ${ref.sessionId} AND agent_id = ${agentId}
        RETURNING agent_id`
      if (updated.length === 0) return null
    } else {
      yield* touchAgent(sql, ref.sessionId, agentId, agentType, now)
      if (input.state === "launched") {
        const description = cleanDescription(input.description)
        const taskId = yield* taskNamed([input.description, input.prompt])
        yield* sql`UPDATE session_agents SET description = COALESCE(${description}, description), task_id = COALESCE(${taskId}, task_id)
          WHERE session_id = ${ref.sessionId} AND agent_id = ${agentId}`
      }
    }
    const agent = (yield* load(ref))!
    // A start, launch or stop is news: told now, whatever the throttle says.
    yield* tell(agent, yield* workspacesOf(agent), now)
    return agent
  }, Effect.orDie)

  const checkIn = Effect.fn("AgentService.checkIn")(function* (caller: Caller["Service"]) {
    if (caller.sessionId === null || !caller.agentId) return
    const agent = yield* load({ sessionId: caller.sessionId, agentId: caller.agentId })
    if (agent === null) return
    const now = yield* Clock.currentTimeMillis
    const due = (yield* workspacesOf(agent)).filter((w) => {
      const last = heard.get(heardKey(agent, w))
      // A clock set back would otherwise hold every check-in until it caught up.
      return last === undefined || now < last || now - last >= PRESENCE_EVERY_MS
    })
    yield* tell(agent, due, now)
  }, Effect.orDie)

  const byRefs = Effect.fn("AgentService.byRefs")(function* (refs: ReadonlyArray<AgentRef>) {
    const found: SessionAgent[] = []
    const seen = new Set<string>()
    for (const ref of refs) {
      const key = `${ref.sessionId}/${ref.agentId}`
      if (seen.has(key)) continue
      seen.add(key)
      const agent = yield* load(ref)
      if (agent) found.push(agent)
    }
    return found.sort((a, b) => a.startedAt - b.startedAt || a.agentId.localeCompare(b.agentId))
  }, Effect.orDie)

  const forBoard = Effect.fn("AgentService.forBoard")(function* (taskIds: ReadonlyArray<string>, sessionIds: ReadonlyArray<string>) {
    const now = yield* Clock.currentTimeMillis
    const onTasks = taskIds.length === 0 ? sql`0` : sql.in("task_id", [...new Set(taskIds)])
    const live = sessionIds.length === 0
      ? sql`0`
      : sql`(ended_at IS NULL AND last_seen_at > ${now - LIVE_AGENT_MS} AND ${sql.in("session_id", [...new Set(sessionIds)])})`
    const rows = yield* sql<AgentRow>`SELECT * FROM session_agents WHERE ${onTasks} OR ${live} ORDER BY started_at, agent_id`
    return rows.map(toAgent)
  }, Effect.orDie)

  return AgentService.of({ report, checkIn, byRefs, forBoard })
})

/** A launch's description as kept: one line, capped. */
const cleanDescription = (value: string | undefined): string | null => {
  const text = value?.replace(/\s+/g, " ").trim().slice(0, MAX_AGENT_TEXT)
  return text ? text : null
}

export const layer = Layer.effect(AgentService, make)
