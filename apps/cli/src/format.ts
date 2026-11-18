// Small text helpers shared by the commands' output.
import { describeEvent, type HistoryNames } from "@cello/client/history"
import type { AgentSession, SessionAgent, Status } from "@cello/contract/entities"
import { isReadable, type StreamedEvent } from "@cello/contract/events"
import type { Activity } from "@cello/contract/views"
import { modelLabel } from "@cello/shared/model"
import { sessionLabel } from "@cello/shared/session"

/** "just now", "3m ago", "2h ago", "4d ago". */
export const ago = (ts: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - ts) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** The model and effort something was written with (CEL-119): a comment's, an event's, or an agent's current ones. */
export interface WrittenWith {
  readonly model?: string | null | undefined
  readonly effort?: string | null | undefined
}

/** "Claude Code session 2fd0505c", and "(Opus 5.5, high)" after it when `written` names a model (CEL-119). */
export const sessionName = (session: Pick<AgentSession, "clientName" | "externalId" | "id">, written?: WrittenWith): string => {
  const model = modelLabel(written?.model, written?.effort)
  return `${sessionLabel(session.clientName, session.externalId ?? session.id)}${model ? ` (${model})` : ""}`
}

/**
 * A session's subagent (CEL-55): "cello-builder · a13bfb89 (under Claude Code session 2fd0505c)", or
 * "agent · a13bfb89" when its type isn't known; the session left out when it isn't. With the model that
 * wrote something (CEL-119): "cello-builder · a13bfb89 (Sonnet 5.5, medium; under Claude Code session 2fd0505c)".
 */
export const agentName = (
  agent: Pick<SessionAgent, "agentId" | "agentType">,
  session?: Pick<AgentSession, "clientName" | "externalId" | "id">,
  written?: WrittenWith,
): string => {
  const notes = [modelLabel(written?.model, written?.effort), session ? `under ${sessionName(session)}` : null].filter((n) => n !== null)
  return `${agent.agentType ?? "agent"} · ${agent.agentId.slice(0, 8)}${notes.length ? ` (${notes.join("; ")})` : ""}`
}

export { andList, plural } from "@cello/shared/words"

/** Pads each column but the last to its widest cell. */
export const columns = (rows: ReadonlyArray<ReadonlyArray<string>>): string[] => {
  const widths: number[] = []
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)))
  return rows.map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  ").trimEnd())
}

/** "2026-11-15 12:00", in local time. */
export const localTime = (ts: number): string => {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** What a command knows by id: the statuses, the sessions and the subagents its rows name. */
export interface Names {
  readonly statuses: ReadonlyArray<Status>
  readonly sessions: ReadonlyArray<AgentSession>
  /** The subagents the rows name (CEL-55). */
  readonly agents?: ReadonlyArray<SessionAgent>
}

/**
 * Who did something: "Claude Code session 2fd0505c", a subagent under it ("cello-builder · a13bfb89
 * (under Claude Code session 2fd0505c)", CEL-55), or the actor's name. `written`: the model and effort a
 * comment or an event was written with, named when known ("Claude Code session 2fd0505c (Opus 5.5, high)",
 * CEL-119); never the agent's current model, which may have changed since.
 */
export const author = (
  names: Names & { readonly actors: ReadonlyArray<{ readonly id: string; readonly name: string }> },
  actorId: string,
  sessionId: string | null,
  agentId?: string | null,
  written?: WrittenWith,
) => {
  const session = names.sessions.find((s) => s.id === sessionId)
  if (sessionId !== null && agentId) {
    return agentName(names.agents?.find((a) => a.sessionId === sessionId && a.agentId === agentId) ?? { agentId, agentType: null }, session, written)
  }
  return session ? sessionName(session, written) : names.actors.find((a) => a.id === actorId)?.name ?? "Someone"
}

type AuthorNames = Parameters<typeof author>[0]

/**
 * One row of a task's history or the project's recent activity: [when, text]. An event this build can't
 * read (a newer server's, CEL-135, CEL-150) has no author to name and may have no time: its text says so.
 */
export const eventCells = (event: StreamedEvent, now: number, names: AuthorNames, historyNames: HistoryNames): [string, string] => [
  event.ts === undefined ? "" : ago(event.ts, now),
  describeEvent(event, historyNames, isReadable(event) ? author(names, event.actorId, event.sessionId, event.agentId, event) : undefined),
]

/**
 * A line under "Claims you lost": the task and how the claim went, "  CEL-1  taken over by Lucas, just now".
 * An event this build can't read says so, with ", <ago>" only when it has a time (CEL-150).
 */
export const lostClaimLine = ({ event, taskKey }: Activity, now: number, names: AuthorNames, historyNames: HistoryNames): string => {
  const key = taskKey ?? "?"
  if (!isReadable(event)) {
    const [when, text] = eventCells(event, now, names, historyNames)
    return `  ${key}  ${text}${when ? `, ${when}` : ""}`
  }
  const who = author(names, event.actorId, event.sessionId, event.agentId, event)
  const how = event.type === "task.claim_ended" ? `ended when ${who} changed it` : `taken over by ${who}`
  return `  ${key}  ${how}, ${ago(event.ts, now)}`
}
