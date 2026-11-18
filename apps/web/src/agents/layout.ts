// The Agents page's rules (CEL-65), kept pure: which row is open (`?open=`, so a reload or a link keeps
// it), and the agents working, as rows (each session, then its subagents) in groups (waiting on Lucas,
// working, quiet), then the ones that finished today (CEL-107). The agents themselves come from
// ../presence/model.ts (workingSessions), the model the sidebar's Agents working reads too, and
// @cello/client/sync/agents (finishedAgents), which `cello agents` reads too.
import { agentPresence, type FinishedAgent, startOfDay } from "@cello/client/sync/agents"
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, SessionAgent, Task } from "@cello/contract/entities"
import { isNeedsInputStatus } from "@cello/shared/ask"
import { type Presence, presenceOf } from "@cello/shared/presence"
import { agentWho, sessionWho, type Who, type Working, type WorkingMark, workingMark } from "../presence/model.ts"

export interface AgentsSearch {
  /** The open row's id (`session:<id>`, `agent:<session>/<agent>`); none: every row is collapsed. */
  readonly open?: string
}

export const parseAgentsSearch = (search: Record<string, unknown>): AgentsSearch => {
  const open = search["open"]
  return typeof open === "string" && /^(session|agent):./.test(open) ? { open } : {}
}

/** One agent on the page: a session, or a subagent under one. */
export interface AgentRow {
  readonly id: string
  readonly kind: "session" | "agent"
  readonly who: Who
  /** "orchestrator" (a session with subagents), "session", or the subagent's type ("cello-builder"). */
  readonly role: string
  readonly session: AgentSession
  /** The subagent; null for a session. */
  readonly agent: SessionAgent | null
  /** A subagent's session, as a row: its parent. */
  readonly parent: Working | null
  readonly presence: Presence
  /** The tasks it's on: the one a subagent's launch named, the ones a session holds. */
  readonly tasks: ReadonlyArray<Task>
  readonly mark: WorkingMark
  /** How many subagents a session has working under it. */
  readonly subagents: number
  /** When a finished agent ended (Finished today); null while it works. */
  readonly endedAt: number | null
}

/** Each session still working, then its subagents, in workingSessions' order: when each started (byStart, CEL-186). */
export const agentRows = (sessions: ReadonlyArray<Working>): AgentRow[] =>
  sessions
    .filter((s) => s.presence !== "ended")
    .flatMap((s) => [
      {
        id: `session:${s.session.id}`,
        kind: "session" as const,
        who: s.who,
        role: s.agents.length > 0 ? "orchestrator" : "session",
        session: s.session,
        agent: null,
        parent: null,
        presence: s.presence,
        tasks: s.tasks,
        mark: s.mark,
        subagents: s.agents.length,
        endedAt: null,
      },
      ...s.agents.map((a) => ({
        id: `agent:${s.session.id}/${a.agent.agentId}`,
        kind: "agent" as const,
        who: a.who,
        role: a.agent.agentType ?? "agent",
        session: s.session,
        agent: a.agent,
        parent: s,
        presence: a.presence,
        tasks: a.task ? [a.task] : [],
        mark: a.mark,
        subagents: 0,
        endedAt: null,
      })),
    ])

/**
 * The tasks a row works on itself: a subagent's task, and the ones a session holds with none of its
 * subagents on them (an orchestrator's builders show theirs), so a card shows once on the page.
 */
export const directTasks = (row: AgentRow, rows: ReadonlyArray<AgentRow>): ReadonlyArray<Task> =>
  row.kind === "agent"
    ? row.tasks
    : row.tasks.filter((t) => !rows.some((r) => r.parent?.session.id === row.session.id && r.tasks.some((rt) => rt.id === t.id)))

/**
 * What makes a row pulse once (CEL-186): its own last call. A call shows on the row where it is,
 * instead of moving it; a session's row pulses for its own calls, not its subagents'.
 */
export const pulseKeyOf = (row: AgentRow): number => (row.agent ?? row.session).lastSeenAt

/** The row of an agent's log on the Agents page: `agent:<session>/<agent>`, or `session:<session>`. */
const rowIdOf = (session: AgentSession, agent: SessionAgent | null) => (agent ? `agent:${session.id}/${agent.agentId}` : `session:${session.id}`)

/**
 * The agents that finished today (finishedAgents), as rows: each with the id it had while it worked, so
 * a link to it opens it in either group; still, unless its task's status says otherwise (done in review).
 */
export const finishedRows = (board: BoardState, finished: ReadonlyArray<FinishedAgent>): AgentRow[] =>
  finished.map((f) => ({
    id: rowIdOf(f.session, f.agent),
    kind: f.agent ? ("agent" as const) : ("session" as const),
    who: f.agent ? agentWho(f.agent, f.session) : sessionWho(f.session),
    role: f.agent ? (f.agent.agentType ?? "agent") : "session",
    session: f.session,
    agent: f.agent,
    parent: null,
    presence: "ended" as const,
    tasks: f.tasks,
    mark: workingMark(board, f.tasks, "ended"),
    subagents: 0,
    endedAt: f.endedAt,
  }))

/**
 * The task panel's Log link (CEL-107): the row of the agent on the task, while the Agents page has it
 * (working, or finished today); null for the human, who has no log, and for an agent that ended before today.
 */
export const logLinkOf = (
  board: BoardState,
  holder: { readonly session: AgentSession | null; readonly agent: SessionAgent | null },
  now: number,
): string | null => {
  const { session, agent } = holder
  if (session === null) return null
  const presence = agent ? agentPresence(board, agent, now) : presenceOf(session, now)
  if (presence !== "ended") return rowIdOf(session, agent)
  const ended = agent ? (agent.endedAt ?? session.endedAt) : session.endedAt
  return ended !== null && ended >= startOfDay(now) ? rowIdOf(session, agent) : null
}

export type AgentGroupId = "waiting" | "working" | "quiet" | "finished"

export interface AgentGroup {
  readonly id: AgentGroupId
  readonly label: string
  readonly rows: ReadonlyArray<AgentRow>
}

const GROUPS: ReadonlyArray<{ id: AgentGroupId; label: string }> = [
  { id: "waiting", label: "Waiting on you" },
  { id: "working", label: "Working" },
  { id: "quiet", label: "Quiet" },
]

/**
 * Finished once it ended; else waiting on Lucas when its task is in Needs input, quiet once it has gone
 * quiet, else working. A subagent waiting on its own background work (CEL-133: its e2e run, a Monitor)
 * is working: quiet only because nothing calls while that work runs.
 */
export const groupOf = (row: AgentRow): AgentGroupId =>
  row.presence === "ended"
    ? "finished"
    : row.mark.mood === "waiting"
    ? "waiting"
    : row.presence === "idle" && !row.agent?.waitingOn
    ? "quiet"
    : "working"

const RANK: Record<AgentGroupId, number> = { waiting: 0, working: 1, quiet: 2, finished: 3 }

/**
 * Where a row is placed: with its session, so subagents always sit under it (CEL-104: quiet subagents
 * used to drop to Quiet on their own, away from the session that counts them). A session and its
 * subagents go to the most pressing group among them: one waiting on Lucas brings the family to Waiting.
 */
const placeOf = (row: AgentRow, rows: ReadonlyArray<AgentRow>): AgentGroupId =>
  rows
    .filter((r) => r.session.id === row.session.id)
    .map(groupOf)
    .reduce((best, g) => (RANK[g] < RANK[best] ? g : best), groupOf(row))

/**
 * The rows in their groups, waiting on Lucas first (like the Review page's Needs your input), then the
 * ones that finished today at the bottom, newest first, each on its own (CEL-107); empty groups left out.
 */
export const agentGroups = (rows: ReadonlyArray<AgentRow>, finished: ReadonlyArray<AgentRow> = []): AgentGroup[] =>
  [
    ...GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => placeOf(r, rows) === g.id) })),
    { id: "finished" as const, label: "Finished today", rows: finished },
  ].filter((g) => g.rows.length > 0)

/** The rows' ids in the order the page shows them: what ↑ ↓ and j k walk. */
export const rowKeysOf = (groups: ReadonlyArray<AgentGroup>): string[] => groups.flatMap((g) => g.rows.map((r) => r.id))

/**
 * The task an agent waits on Lucas about: the first it's on that's in Needs input (an orchestrator's
 * may not be its first task). What its Answer on Review link opens, and its row's state shows.
 */
export const waitingTaskOf = (
  row: AgentRow,
  statuses: Readonly<Record<string, { readonly name: string; readonly category: string }>>,
): Task | undefined =>
  row.tasks.find((t) => {
    const status = statuses[t.statusId]
    return status !== undefined && isNeedsInputStatus(status)
  })

/**
 * The task whose state a row shows on its right: the one waiting on Lucas, else the first it's on.
 * An orchestrator shows one too, like any session (CEL-104): it used to show none on the grounds that
 * its subagent rows show theirs, which left it blank once they went quiet or had no row.
 */
export const stateTaskOf = (
  row: AgentRow,
  statuses: Readonly<Record<string, { readonly name: string; readonly category: string }>>,
): Task | undefined => waitingTaskOf(row, statuses) ?? row.tasks[0]

/**
 * The project a row belongs to when the page is narrowed to one (CEL-188): a session's is the one its
 * row shows (stateTaskOf), else its first subagent's task; a subagent under its session shares it, so a
 * family is never split. A finished row stands on its own. Null: no task, so it shows under All only.
 */
export const homeProjectOf = (
  row: AgentRow,
  rows: ReadonlyArray<AgentRow>,
  statuses: Readonly<Record<string, { readonly name: string; readonly category: string }>>,
): string | null => {
  if (row.kind === "agent") {
    const session = row.parent === null ? undefined : rows.find((r) => r.kind === "session" && r.session.id === row.session.id)
    return session ? homeProjectOf(session, rows, statuses) : (stateTaskOf(row, statuses)?.projectId ?? null)
  }
  const own = stateTaskOf(row, statuses)
  if (own) return own.projectId
  return rows.find((r) => r.kind === "agent" && r.session.id === row.session.id && r.tasks.length > 0)?.tasks[0]?.projectId ?? null
}

/** The rows of `projectId` (null: all of them), each family whole. */
export const filterAgentRows = (
  rows: ReadonlyArray<AgentRow>,
  projectId: string | null,
  statuses: Readonly<Record<string, { readonly name: string; readonly category: string }>>,
): AgentRow[] => (projectId === null ? [...rows] : rows.filter((r) => homeProjectOf(r, rows, statuses) === projectId))

/**
 * The project of every row the page lists, working and finished today, for the chips (null: none): the
 * same `homeProjectOf` the filter uses, each list on its own, so a chip's count is what its pick shows.
 */
export const agentProjectIds = (
  rows: ReadonlyArray<AgentRow>,
  finished: ReadonlyArray<AgentRow>,
  statuses: Readonly<Record<string, { readonly name: string; readonly category: string }>>,
): Array<string | null> => [...rows.map((r) => homeProjectOf(r, rows, statuses)), ...finished.map((r) => homeProjectOf(r, finished, statuses))]

/** How the Agents page orders the families in each group (CEL-188); Started, when they began, is the default. */
export const AGENT_SORTS = ["started", "active", "project", "task"] as const
export type AgentSort = (typeof AGENT_SORTS)[number]
export const AGENT_SORT_LABELS: Readonly<Record<AgentSort, string>> = { started: "Started", active: "Last active", project: "Project", task: "Task" }

/**
 * The rows with their families (a session and its subagents) in `sort`'s order, each family whole and
 * its subagents in the order they started. Started keeps the order given; Last active puts the family
 * whose agents checked in last first; Project goes by the project's name, Task by the first task's
 * project and number, rows with no task last. Ties keep the order given.
 */
export const sortFamilies = (
  rows: ReadonlyArray<AgentRow>,
  sort: AgentSort,
  projectName: (projectId: string) => string,
  statuses: Readonly<Record<string, { readonly name: string; readonly category: string }>>,
): AgentRow[] => {
  if (sort === "started") return [...rows]
  const families = new Map<string, AgentRow[]>()
  for (const row of rows) families.set(row.session.id, [...(families.get(row.session.id) ?? []), row])
  const lastActive = (family: ReadonlyArray<AgentRow>) => Math.max(...family.map(pulseKeyOf))
  const home = (family: ReadonlyArray<AgentRow>) => homeProjectOf(family[0]!, rows, statuses)
  const nameOf = (family: ReadonlyArray<AgentRow>) => {
    const id = home(family)
    return id === null ? null : projectName(id)
  }
  /** Rows with no project (or task) sort after the ones that have. */
  const byName = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b))
  const numberOf = (family: ReadonlyArray<AgentRow>) => stateTaskOf(family[0]!, statuses)?.number ?? null
  const compare: Record<Exclude<AgentSort, "started">, (a: ReadonlyArray<AgentRow>, b: ReadonlyArray<AgentRow>) => number> = {
    active: (a, b) => lastActive(b) - lastActive(a),
    project: (a, b) => byName(nameOf(a), nameOf(b)),
    task: (a, b) => byName(nameOf(a), nameOf(b)) || (numberOf(a) === null ? (numberOf(b) === null ? 0 : 1) : numberOf(b) === null ? -1 : numberOf(a)! - numberOf(b)!),
  }
  return [...families.values()].sort(compare[sort]).flat()
}

/** "1 subagent", "3 subagents". */
export const subagentsLabel = (n: number): string => `${n} ${n === 1 ? "subagent" : "subagents"}`
