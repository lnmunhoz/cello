// The Agents page's rules (CEL-65, phase 1 design prototype), kept pure: which layout the prototype
// shows (`?agents=a|b|c`, a temporary switch while Lucas picks one), which row is open (`?open=`), and
// the agents working, as rows (each session, then its subagents) and in groups (waiting on Lucas,
// working, quiet). The agents themselves come from ../presence/model.ts (workingSessions).
import type { AgentSession, SessionAgent, Task } from "@cello/contract/entities"
import type { Presence } from "@cello/shared/presence"
import type { Who, Working, WorkingMark } from "../presence/model.ts"

/** The prototype's layouts: A review-style rows, B grouped by session, C a grid of cards. */
export type AgentsLayout = "a" | "b" | "c"

export interface AgentsSearch {
  readonly agents?: AgentsLayout
  /** The open row's id (`session:<id>`, `agent:<session>/<agent>`); none: every row is collapsed. */
  readonly open?: string
}

const LAYOUTS: ReadonlyArray<string> = ["a", "b", "c"]

export const parseAgentsSearch = (search: Record<string, unknown>): AgentsSearch => {
  const agents = typeof search["agents"] === "string" && LAYOUTS.includes(search["agents"]) ? (search["agents"] as AgentsLayout) : undefined
  const open = typeof search["open"] === "string" && /^(session|agent):/.test(search["open"]) ? search["open"] : undefined
  return { ...(agents ? { agents } : {}), ...(open ? { open } : {}) }
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
}

/** Each session still working, then its subagents, in workingSessions' order (active first, freshest first). */
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

export type AgentGroupId = "waiting" | "working" | "quiet"

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

/** Waiting on Lucas when its task is in Needs input, quiet once it has gone quiet, else working. */
export const groupOf = (row: AgentRow): AgentGroupId => (row.mark.mood === "waiting" ? "waiting" : row.presence === "idle" ? "quiet" : "working")

/** The rows in their groups, waiting on Lucas first (like the Review page's Needs your input), empty groups left out. */
export const agentGroups = (rows: ReadonlyArray<AgentRow>): AgentGroup[] =>
  GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => groupOf(r) === g.id) })).filter((g) => g.rows.length > 0)
