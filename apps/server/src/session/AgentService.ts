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
import { parseBackground, parseRuns, parseWaiting, stopOutcome, stored, testsOf, testsTurnEnded } from "./activity.ts"
import { cleanAgentText, cleanTranscript, CONTROL_CHARACTERS, MAX_AGENT_TEXT, PRESENCE_EVERY_MS, touchAgent } from "./SessionService.ts"

/** What a hook says happened to a subagent of the caller's session. */
export interface AgentReport {
  readonly agentId: string
  readonly agentType: string | null
  readonly state: AgentReportState
  readonly description?: string | undefined
  readonly prompt?: string | undefined
  /** The subagent's own transcript, as the hook knows it (CEL-106); kept until another is reported. */
  readonly transcriptPath?: string | undefined
  /** On a stop (CEL-133): the ids of the session's background work still running; absent when unknown. */
  readonly running?: ReadonlyArray<string> | undefined
}

/** One agent, by its session and host id. */
export interface AgentRef {
  readonly sessionId: string
  readonly agentId: string
}

/** How long a quiet agent that never stopped still comes with a board, so the sidebar can list it. */
export const LIVE_AGENT_MS = 24 * 60 * 60 * 1000

/**
 * How long an agent that finished still comes with a board (CEL-107): the Agents page lists the ones that
 * ended today under "Finished today", and opens their logs. A day covers any "today" the board's clock has.
 */
export const FINISHED_AGENT_MS = 24 * 60 * 60 * 1000

interface AgentRow {
  session_id: string
  agent_id: string
  agent_type: string | null
  task_id: string | null
  description: string | null
  started_at: number
  last_seen_at: number
  ended_at: number | null
  /** CEL-106; left out by selects that don't need them. */
  transcript_path?: string | null
  current_step?: string | null
  current_step_at?: number | null
  /** CEL-119; left out by selects that don't need them. */
  model?: string | null
  effort?: string | null
  /** CEL-133; left out by selects that don't need them. */
  background_json?: string | null
  waiting_json?: string | null
  /** CEL-134; left out by selects that don't need it. */
  tests_json?: string | null
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
  hasLog: r.transcript_path != null,
  currentStep: r.current_step ?? null,
  currentStepAt: r.current_step_at ?? null,
  model: r.model ?? null,
  effort: r.effort ?? null,
  waitingOn: parseWaiting(r.waiting_json),
  tests: testsOf(r.tests_json),
})

export class AgentService extends Context.Service<AgentService, {
  /** What a hook saw (SubagentStart, the Agent tool's launch, SubagentStop), for the caller's session. Null for the human or an unknown stop. */
  readonly report: (input: AgentReport) => Effect.Effect<SessionAgent | null, never, Caller>
  /** After an agent's request: boards hear it's working, unless they heard within PRESENCE_EVERY_MS. Others: nothing. */
  readonly checkIn: (caller: Caller["Service"]) => Effect.Effect<void>
  /** Boards hear what the agent is doing now (`agent.seen`), whatever the throttle says: its test run started, moved or ended (CEL-134). */
  readonly announce: (ref: AgentRef) => Effect.Effect<void>
  /** Agents by session and id; unknown ones are left out. */
  readonly byRefs: (refs: ReadonlyArray<AgentRef>) => Effect.Effect<ReadonlyArray<SessionAgent>>
  /**
   * What a board needs: the agents still working (not stopped) on these tasks, and the live ones (not
   * stopped, seen within LIVE_AGENT_MS) of these sessions; and on either, the ones that stopped within
   * FINISHED_AGENT_MS (Finished today, CEL-107). Oldest first. The agent that last changed a task comes
   * from `byRefs`, finished or not.
   */
  readonly forBoard: (taskIds: ReadonlyArray<string>, sessionIds: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<SessionAgent>>
  /** Every agent ever launched on a task, finished ones too, oldest first: `cello task get` lists them. */
  readonly onTask: (taskId: string) => Effect.Effect<ReadonlyArray<SessionAgent>>
}>()("cello/AgentService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands
  /** When each `<session> <agent> <workspace>` last got an agent.seen. In memory: a restart sends one again. */
  const heard = new Map<string, number>()
  /**
   * What boards last heard each `<session> <agent>` doing (CEL-133): working, waiting on its background
   * work, or finished. A check-in that changes it is news, whatever the throttle says: a finished or
   * waiting agent that calls again is working again, and its row leaves Finished today at once.
   */
  const told = new Map<string, string>()
  const doing = (agent: SessionAgent) => (agent.endedAt !== null ? "finished" : agent.waitingOn ? "waiting" : "working")
  const agentKey = (agent: SessionAgent) => `${agent.sessionId} ${agent.agentId}`

  const load = (ref: AgentRef) =>
    sql<AgentRow>`SELECT * FROM session_agents WHERE session_id = ${ref.sessionId} AND agent_id = ${ref.agentId}`.pipe(
      Effect.map((rows) => (rows[0] ? toAgent(rows[0]) : null)),
    )

  /** The first task the text names, by key, that exists. */
  /**
   * The task a launch names: the description first, then the prompt. In each, of the keys that are real
   * tasks, the first one `sessionId` holds a claim on, else the first one (a brief often mentions other
   * tasks after its own).
   */
  const taskNamed = (sessionId: string, texts: ReadonlyArray<string | undefined>) =>
    Effect.gen(function* () {
      for (const text of texts) {
        const found: Array<{ id: string; assignee_session_id: string | null }> = []
        for (const key of text ? taskKeysIn(text) : []) {
          const parsed = parseTaskKey(key)!
          const rows = yield* sql<{ id: string; assignee_session_id: string | null }>`
            SELECT t.id, t.assignee_session_id FROM tasks t JOIN projects p ON p.id = t.project_id
            WHERE p.key = ${parsed.projectKey} AND t.number = ${parsed.number}`
          if (rows[0]) found.push(rows[0])
        }
        const pick = found.find((t) => t.assignee_session_id === sessionId) ?? found[0]
        if (pick) return pick.id
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
      told.set(agentKey(agent), doing(agent))
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
    const transcript = cleanTranscript(input.transcriptPath)
    if (input.state === "stopped") {
      // Claude Code's own helpers (prompt suggestions, /btw) stop without ever starting here: not recorded.
      const [row] = yield* sql<Pick<AgentRow, "background_json" | "tests_json">>`
        SELECT background_json, tests_json FROM session_agents WHERE session_id = ${ref.sessionId} AND agent_id = ${agentId}`
      if (!row) return null
      // Background work it started is still running (CEL-133): it waits on it, and Claude Code resumes it after.
      const outcome = stopOutcome(parseBackground(row.background_json), input.running)
      // A test run its turn leaves behind is over, unless it runs on in the background (CEL-134).
      const tests = stored(parseRuns(row.tests_json).map((run) => testsTurnEnded(run, input.running, now)))
      yield* sql`UPDATE session_agents SET ended_at = ${outcome.finished ? now : null}, waiting_json = ${stored(outcome.waitingOn)},
          background_json = ${stored(outcome.background)}, tests_json = ${tests}, transcript_path = COALESCE(${transcript}, transcript_path)
        WHERE session_id = ${ref.sessionId} AND agent_id = ${agentId}`
    } else if (input.state === "started") {
      // SubagentStart: a new agent, or a resumed one (live again).
      yield* touchAgent(sql, ref.sessionId, agentId, agentType, now, { transcript, step: null })
    } else {
      // The Agent tool returned. For a foreground agent that's after it finished, so a launch only links
      // the task and description: it never revives a stopped agent (only a start or the agent's own call does).
      const description = cleanDescription(input.description)
      const taskId = yield* taskNamed(ref.sessionId, [input.description, input.prompt])
      yield* sql`INSERT INTO session_agents (session_id, agent_id, agent_type, task_id, description, started_at, last_seen_at, transcript_path)
        VALUES (${ref.sessionId}, ${agentId}, ${agentType}, ${taskId}, ${description}, ${now}, ${now}, ${transcript})
        ON CONFLICT (session_id, agent_id) DO UPDATE SET
          agent_type = COALESCE(excluded.agent_type, agent_type),
          task_id = COALESCE(excluded.task_id, task_id),
          description = COALESCE(excluded.description, description),
          transcript_path = COALESCE(excluded.transcript_path, transcript_path)`
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
    const workspaces = yield* workspacesOf(agent)
    // Back from finished or waiting (CEL-133): boards hear it at once.
    const news = told.has(agentKey(agent)) && told.get(agentKey(agent)) !== doing(agent)
    const due = news ? workspaces : workspaces.filter((w) => {
      const last = heard.get(heardKey(agent, w))
      // A clock set back would otherwise hold every check-in until it caught up.
      return last === undefined || now < last || now - last >= PRESENCE_EVERY_MS
    })
    yield* tell(agent, due, now)
  }, Effect.orDie)

  const announce = Effect.fn("AgentService.announce")(function* (ref: AgentRef) {
    const agent = yield* load(ref)
    if (agent === null) return
    yield* tell(agent, yield* workspacesOf(agent), yield* Clock.currentTimeMillis)
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
    const finished = sql`ended_at > ${now - FINISHED_AGENT_MS}`
    const onTasks = taskIds.length === 0 ? sql`0` : sql`((ended_at IS NULL OR ${finished}) AND ${sql.in("task_id", [...new Set(taskIds)])})`
    const live = sessionIds.length === 0
      ? sql`0`
      : sql`(((ended_at IS NULL AND last_seen_at > ${now - LIVE_AGENT_MS}) OR ${finished}) AND ${sql.in("session_id", [...new Set(sessionIds)])})`
    const rows = yield* sql<AgentRow>`SELECT * FROM session_agents WHERE ${onTasks} OR ${live} ORDER BY started_at, agent_id`
    return rows.map(toAgent)
  }, Effect.orDie)

  const onTask = Effect.fn("AgentService.onTask")(function* (taskId: string) {
    const rows = yield* sql<AgentRow>`SELECT * FROM session_agents WHERE task_id = ${taskId} ORDER BY started_at, agent_id`
    return rows.map(toAgent)
  }, Effect.orDie)

  return AgentService.of({ report, checkIn, announce, byRefs, forBoard, onTask })
})

/** A launch's description as kept: one line, capped. */
const cleanDescription = (value: string | undefined): string | null => {
  const text = value?.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim().slice(0, MAX_AGENT_TEXT)
  return text ? text : null
}

export const layer = Layer.effect(AgentService, make)
