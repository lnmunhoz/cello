// The Agents page's live log (CEL-106): the words and numbers only the page shows, kept pure so they're tested
// here. What `cello agents log` shows too (durations, previews, why there's no log) is in @cello/client/sync/agentLog.
import type { SessionRun, TaskWake } from "@cello/contract/entities"

/** The woken runs (CEL-92) of a session the board knows of (each task's latest), newest first. */
export const runsOf = (wakes: Readonly<Record<string, TaskWake>>, sessionId: string): ReadonlyArray<SessionRun> => {
  const byId = new Map<string, SessionRun>()
  for (const wake of Object.values(wakes)) if (wake.sessionId === sessionId && wake.run) byId.set(wake.run.id, wake.run)
  return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt)
}

/** "Woken run · 15:58 · completed" */
export const runLabel = (run: SessionRun): string =>
  `Woken run · ${new Date(run.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${run.outcome}`

/** Text split on its backticks, so what's between a pair can show as code. */
export const codeParts = (text: string): ReadonlyArray<{ readonly text: string; readonly code: boolean }> =>
  text.split("`").map((part, i) => ({ text: part, code: i % 2 === 1 })).filter((part) => part.text !== "")

/** Within this many pixels of the end, the log counts as scrolled to the bottom: it follows new steps. */
export const BOTTOM_SLACK = 24

export const atBottom = (el: { readonly scrollTop: number; readonly clientHeight: number; readonly scrollHeight: number }): boolean =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK
