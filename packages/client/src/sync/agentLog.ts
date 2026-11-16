// An agent's live log on the client (CEL-106): the steps `agent.log` has sent so far, kept in order, a
// step sent again (a tool call whose result arrived) replacing the one with its id; which of them a
// filter shows; and the words both the Agents page and `cello agents log` (CEL-107) use.
import type { LogStep, LogUnavailable, LogUpdate } from "@cello/contract/agentLog"
import type { AgentSession, SessionAgent } from "@cello/contract/entities"
import type { Presence } from "@cello/shared/presence"

export interface LogView {
  /** `loading` until the first update; `unavailable` with its reason when there's no log. */
  readonly status: "loading" | "ready" | "unavailable"
  readonly reason: LogUnavailable | null
  /** How many older steps the first batch left out. */
  readonly skipped: number
  /** A long transcript was read only from near its end: there are earlier steps it didn't count. */
  readonly older: boolean
  readonly steps: ReadonlyArray<LogStep>
  /**
   * The steps the latest update added while following (CEL-107), which the page fades in. Never the
   * first batch or a reconnect's (they replace what's shown), nor a step sent again to update it.
   */
  readonly arrived: ReadonlyArray<string>
}

export const EMPTY_LOG: LogView = { status: "loading", reason: null, skipped: 0, older: false, steps: [], arrived: [] }

export const applyLogUpdate = (view: LogView, update: LogUpdate): LogView => {
  if (update._tag === "unavailable") return { ...EMPTY_LOG, status: "unavailable", reason: update.reason }
  if (update.reset) return { status: "ready", reason: null, skipped: update.skipped, older: update.older === true, steps: update.steps, arrived: [] }
  const index = new Map(view.steps.map((s, i) => [s.id, i]))
  const steps = [...view.steps]
  const arrived: string[] = []
  for (const step of update.steps) {
    const at = index.get(step.id)
    if (at === undefined) {
      index.set(step.id, steps.length)
      steps.push(step)
      arrived.push(step.id)
    } else steps[at] = step
  }
  return { ...view, status: "ready", steps, arrived }
}

/** The log's filters: everything, what was said (prompts and messages), tool calls, or failed calls. */
export type LogFilter = "all" | "messages" | "tools" | "errors"

const isCall = (step: LogStep) => step.kind === "tool" || step.kind === "agent"

/** The steps `filter` shows; thinking only with its switch on (and never among tools or errors). */
export const filterSteps = (steps: ReadonlyArray<LogStep>, filter: LogFilter, thinking: boolean): ReadonlyArray<LogStep> =>
  steps.filter((step) => {
    if (step.kind === "thinking") return thinking && (filter === "all" || filter === "messages")
    if (filter === "messages") return step.kind === "message" || step.kind === "user"
    if (filter === "tools") return isCall(step)
    if (filter === "errors") return isCall(step) && step.tool?.status === "error"
    return true
  })

/** Whose log, as the atom family's key. */
export interface LogSourceKey {
  readonly sessionId: string
  readonly agentId?: string | undefined
  readonly runId?: string | undefined
  readonly reveal?: boolean | undefined
}

export const logKey = (source: LogSourceKey): string =>
  JSON.stringify([source.sessionId, source.agentId ?? null, source.runId ?? null, source.reveal === true])

export const parseLogKey = (key: string): { sessionId: string; agentId: string | undefined; runId: string | undefined; reveal: boolean } => {
  const [sessionId, agentId, runId, reveal] = JSON.parse(key) as [string, string | null, string | null, boolean]
  return { sessionId, agentId: agentId ?? undefined, runId: runId ?? undefined, reveal }
}

/**
 * What the row says the agent is doing right now: its last tool call, only while it's working. Once it
 * goes quiet or finishes, the last step it reported is no longer "now". A subagent that ended its turn
 * while its own background work runs (CEL-133) is waiting on that work, quiet or not.
 */
export const currentStepOf = (row: { readonly presence: Presence; readonly agent: SessionAgent | null; readonly session: AgentSession }): string | null => {
  if (row.presence !== "ended" && row.agent?.waitingOn) return waitingWords(row.agent.waitingOn)
  if (row.presence !== "active") return null
  return (row.agent ? row.agent.currentStep : row.session.currentStep) ?? null
}

/** "Waiting on background work: Bash · bun run test:e2e" (CEL-133). */
export const waitingWords = (on: ReadonlyArray<string>): string => `Waiting on background work: ${on.join(", ")}`

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
  if (reason === "unreadable") return "Cello couldn't read this log file."
  if (reason === "refused") return "Cello won't read this log: its transcript is outside Claude Code's projects folder."
  return "No log yet. It shows up once this agent's Claude Code hooks say where its transcript is (`cello install claude` adds them)."
}
