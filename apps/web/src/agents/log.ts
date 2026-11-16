// The Agents page's live log (CEL-106): the words and numbers it shows, kept pure so they're tested here.
import type { LogUnavailable } from "@cello/contract/agentLog"
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

/** How long a tool call took: "40 ms", "2.5 s", "1 min 35 s"; empty when unknown. */
export const durationWords = (ms: number | null): string => {
  if (ms === null) return ""
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return seconds === 0 || minutes >= 60 ? `${minutes} min` : `${minutes} min ${seconds} s`
}

/** A result's first `lines` lines, and how many lines come after them. */
export const previewOf = (output: string, lines: number): { readonly text: string; readonly more: number } => {
  const all = output.split("\n")
  return { text: all.slice(0, lines).join("\n"), more: Math.max(0, all.length - lines) }
}

/** Why there's no log, for an agent that's still working (`live`) or not. */
export const unavailableWords = (reason: LogUnavailable, live: boolean): string => {
  if (reason === "missing") return live ? "This log isn't on disk yet. It shows up here as soon as Claude Code writes it." : "This log is no longer on disk."
  if (reason === "refused") return "Cello won't read this log: its transcript is outside Claude Code's projects folder."
  return "No log yet. It shows up once this agent's Claude Code hooks say where its transcript is (`cello install claude` adds them)."
}

/** Within this many pixels of the end, the log counts as scrolled to the bottom: it follows new steps. */
export const BOTTOM_SLACK = 24

export const atBottom = (el: { readonly scrollTop: number; readonly clientHeight: number; readonly scrollHeight: number }): boolean =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK
