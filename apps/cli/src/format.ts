// Small text helpers shared by the commands' output.
import type { AgentSession, SessionAgent } from "@cello/contract/entities"

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

/** The first 8 characters of a host session id, enough to recognise it ("2fd0505c"). */
export const shortSession = (id: string): string => id.slice(0, 8)

/** "Claude Code session 2fd0505c". */
export const sessionName = (session: Pick<AgentSession, "clientName" | "externalId" | "id">): string =>
  `${session.clientName} session ${shortSession(session.externalId ?? session.id)}`

/**
 * A session's subagent (CEL-55): "cello-builder · a13bfb89 (under Claude Code session 2fd0505c)", or
 * "agent · a13bfb89" when its type isn't known; the session left out when it isn't.
 */
export const agentName = (
  agent: Pick<SessionAgent, "agentId" | "agentType">,
  session?: Pick<AgentSession, "clientName" | "externalId" | "id">,
): string => `${agent.agentType ?? "agent"} · ${agent.agentId.slice(0, 8)}${session ? ` (under ${sessionName(session)})` : ""}`

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
