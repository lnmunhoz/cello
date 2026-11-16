// An agent's live log on the client (CEL-106): the steps `agent.log` has sent so far, kept in order, a
// step sent again (a tool call whose result arrived) replacing the one with its id; and which of them a
// filter shows.
import type { LogStep, LogUnavailable, LogUpdate } from "@cello/contract/agentLog"

export interface LogView {
  /** `loading` until the first update; `unavailable` with its reason when there's no log. */
  readonly status: "loading" | "ready" | "unavailable"
  readonly reason: LogUnavailable | null
  /** How many older steps the first batch left out. */
  readonly skipped: number
  readonly steps: ReadonlyArray<LogStep>
}

export const EMPTY_LOG: LogView = { status: "loading", reason: null, skipped: 0, steps: [] }

export const applyLogUpdate = (view: LogView, update: LogUpdate): LogView => {
  if (update._tag === "unavailable") return { status: "unavailable", reason: update.reason, skipped: 0, steps: [] }
  if (update.reset) return { status: "ready", reason: null, skipped: update.skipped, steps: update.steps }
  const index = new Map(view.steps.map((s, i) => [s.id, i]))
  const steps = [...view.steps]
  for (const step of update.steps) {
    const at = index.get(step.id)
    if (at === undefined) {
      index.set(step.id, steps.length)
      steps.push(step)
    } else steps[at] = step
  }
  return { ...view, status: "ready", steps }
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
