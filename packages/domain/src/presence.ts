// Who is working on a task right now (CEL-35), from the agent session holding its claim. The server
// keeps `lastSeenAt` current (every CLI call and hook) and sets `endedAt` when the session's process
// exits; the board reads both through these, so a card, the panel and the sidebar always agree.

/** active: checked in within ACTIVE_MS. idle: quiet longer, process still there. ended: the process exited. */
export type Presence = "active" | "idle" | "ended"

/**
 * How long after its last check-in a session still counts as working. A session with the hooks
 * installed checks in on every tool call, so a few quiet minutes means it's thinking or waiting.
 */
export const ACTIVE_MS = 5 * 60_000

export interface SessionLike {
  readonly lastSeenAt: number
  readonly endedAt: number | null
  /**
   * A session's latest woken run (CEL-92): while it goes (`endedAt` null) Cello is running the session,
   * so it's active, even before the run's first check-in (CEL-136).
   */
  readonly lastRun?: { readonly endedAt: number | null } | null | undefined
}

export const presenceOf = (session: SessionLike, now: number): Presence => {
  if (session.lastRun != null && session.lastRun.endedAt === null) return "active"
  if (session.endedAt !== null) return "ended"
  return now - session.lastSeenAt <= ACTIVE_MS ? "active" : "idle"
}

/** "just now", "4m ago", "3h ago", "2d ago". */
export const agoShort = (ts: number, now: number): string => {
  const minutes = Math.floor(Math.max(0, now - ts) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** "active now", "seen 2h ago" or "ended": what the board says next to the session. */
export const presenceWords = (session: SessionLike, now: number): string => {
  const presence = presenceOf(session, now)
  if (presence === "active") return "active now"
  if (presence === "ended") return "ended"
  return `seen ${agoShort(session.lastSeenAt, now)}`
}
