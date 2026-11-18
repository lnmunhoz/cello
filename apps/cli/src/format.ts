// Small text helpers shared by the commands' output.
import type { AgentSession, SessionAgent } from "@cello/contract/entities"
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

/** "1 task", "3 tasks". */
export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`

export { andList } from "@cello/shared/words"

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
