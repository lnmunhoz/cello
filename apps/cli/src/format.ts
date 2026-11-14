// Small text helpers shared by the commands' output.
import type { AgentSession } from "@cello/contract/entities"

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

/** Pads each column but the last to its widest cell. */
export const columns = (rows: ReadonlyArray<ReadonlyArray<string>>): string[] => {
  const widths: number[] = []
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)))
  return rows.map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  ").trimEnd())
}
