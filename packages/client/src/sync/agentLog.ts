// An agent's live log on the client (CEL-106): the steps `agent.log` has sent so far, kept in order, a
// step sent again (a tool call whose result arrived) replacing the one with its id; which of them a
// filter shows; and the words both the Agents page and `cello agents log` (CEL-107) use.
import type { LogStep, LogUnavailable, LogUpdate } from "@cello/contract/agentLog"
import type { AgentSession, SessionAgent } from "@cello/contract/entities"
import type { Presence } from "@cello/shared/presence"
import { isRunning, testRunWords } from "@cello/shared/testRun"
import { plural } from "@cello/shared/words"

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
  /** How many thoughts so far Claude Code wrote without their words (CEL-170); see `thinkingNote`. */
  readonly unsavedThinking: number
}

export const EMPTY_LOG: LogView = { status: "loading", reason: null, skipped: 0, older: false, steps: [], arrived: [], unsavedThinking: 0 }

export const applyLogUpdate = (view: LogView, update: LogUpdate): LogView => {
  if (update._tag === "unavailable") return { ...EMPTY_LOG, status: "unavailable", reason: update.reason }
  if (update.reset) {
    return { status: "ready", reason: null, skipped: update.skipped, older: update.older === true, steps: update.steps, arrived: [], unsavedThinking: update.unsavedThinking ?? 0 }
  }
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
  return { ...view, status: "ready", steps, arrived, unsavedThinking: update.unsavedThinking ?? view.unsavedThinking }
}

/** The log's views (CEL-170): the story (calls grouped, finished turns folded), every step, or only failed calls. */
export type LogShow = "story" | "everything" | "errors"

const isCall = (step: LogStep) => step.kind === "tool" || step.kind === "agent"

/** The steps the flat views show; thinking only with its switch on (and never among errors). */
export const filterSteps = (steps: ReadonlyArray<LogStep>, show: Exclude<LogShow, "story">, thinking: boolean): ReadonlyArray<LogStep> =>
  steps.filter((step) => {
    if (step.kind === "thinking") return thinking && show === "everything"
    if (show === "errors") return isCall(step) && step.tool?.status === "error"
    return true
  })

/**
 * Said under the Thinking switch when it's on and shows nothing because Claude Code saved the thoughts
 * without their words (CEL-170). It does that unless `showThinkingSummaries` is on in its settings.
 */
export const thinkingNote = (view: Pick<LogView, "unsavedThinking" | "steps">): string | null =>
  view.unsavedThinking > 0 && !view.steps.some((step) => step.kind === "thinking")
    ? "Claude Code didn't save this agent's thinking, only a signature. Turn on `showThinkingSummaries` in ~/.claude/settings.json: sessions started after that save a summary of each thought."
    : null

/** What the Story view lists, in order. */
export type StoryItem =
  /** A prompt, a message, a note, a launch, a lone call or a lone thought. */
  | { readonly _tag: "step"; readonly step: LogStep }
  /** Two or more calls in a row (with the thoughts between them, when thinking shows), folded to one row. */
  | {
      readonly _tag: "group"
      readonly id: string
      readonly steps: ReadonlyArray<LogStep>
      readonly calls: number
      readonly summary: string
      readonly failed: number
      readonly durationMs: number | null
    }
  /** A call still running while the agent works. */
  | { readonly _tag: "live"; readonly step: LogStep }
  /** The work of a turn that ended, folded under "Worked for 4 min 12 s". */
  | { readonly _tag: "turn"; readonly id: string; readonly durationMs: number | null; readonly items: ReadonlyArray<StoryItem> }

/** What a group's call did, for its summary. */
type CallKind = "command" | "read" | "edit" | "search" | "web" | "other"

const callKind = (name: string): CallKind => {
  if (name === "Bash") return "command"
  if (name === "Read") return "read"
  if (name === "Edit" || name === "MultiEdit" || name === "Write" || name === "NotebookEdit") return "edit"
  if (name === "Grep" || name === "Glob") return "search"
  if (name === "WebFetch" || name === "WebSearch") return "web"
  return "other"
}

/** What a call works on, from its line: "a.ts" for "Read · a.ts", so a file read twice counts once. */
const targetOf = (step: LogStep): string => {
  const prefix = `${step.tool?.name ?? ""} · `
  return step.text.startsWith(prefix) ? step.text.slice(prefix.length) : step.text
}

/** "Ran 9 commands, read 3 files": a group's calls by what they did, in order of first appearance. */
const groupSummary = (calls: ReadonlyArray<LogStep>): string => {
  const kinds = new Map<CallKind, Set<string>>()
  for (const call of calls) {
    const kind = callKind(call.tool?.name ?? "")
    const seen = kinds.get(kind) ?? new Set<string>()
    // Files are counted once however often they're touched; everything else once per call.
    seen.add(kind === "read" || kind === "edit" ? targetOf(call) : call.id)
    kinds.set(kind, seen)
  }
  const words = [...kinds].map(([kind, seen]) => {
    const n = seen.size
    if (kind === "command") return `ran ${plural(n, "command")}`
    if (kind === "read") return `read ${plural(n, "file")}`
    if (kind === "edit") return `edited ${plural(n, "file")}`
    if (kind === "search") return `searched ${plural(n, "time")}`
    if (kind === "web") return `browsed the web ${plural(n, "time")}`
    return `used ${plural(n, kinds.size === 1 ? "tool" : "other tool")}`
  })
  const text = words.join(", ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** From the earliest call to the latest result; null when no call says when. */
const spanOf = (calls: ReadonlyArray<LogStep>): number | null => {
  const timed = calls.filter((call): call is LogStep & { at: number } => call.at !== null)
  if (timed.length === 0) return null
  return Math.max(...timed.map((call) => call.at + (call.tool?.durationMs ?? 0))) - Math.min(...timed.map((call) => call.at))
}

const itemOf = (step: LogStep): StoryItem => ({ _tag: "step", step })

/** One run of calls (and thoughts): a group when it holds two or more calls, else its steps as they are; running calls last as live rows when `live`. */
const runItems = (run: ReadonlyArray<LogStep>, live: boolean): ReadonlyArray<StoryItem> => {
  const running = live ? run.filter((step) => step.kind === "tool" && step.tool?.status === "running") : []
  const rest = running.length === 0 ? run : run.filter((step) => !running.includes(step))
  const calls = rest.filter((step) => step.kind === "tool")
  const body: ReadonlyArray<StoryItem> =
    calls.length >= 2
      ? [
          {
            _tag: "group",
            id: `group:${rest[0]!.id}`,
            steps: rest,
            calls: calls.length,
            summary: groupSummary(calls),
            failed: calls.filter((call) => call.tool?.status === "error").length,
            durationMs: spanOf(calls),
          },
        ]
      : rest.map(itemOf)
  return [...body, ...running.map((step): StoryItem => ({ _tag: "live", step }))]
}

/** Steps as story items: runs of calls grouped, everything else as it is. `live` lets the last run's running calls out as live rows. */
const itemsOf = (steps: ReadonlyArray<LogStep>, thinking: boolean, live: boolean): ReadonlyArray<StoryItem> => {
  const segments: Array<LogStep | LogStep[]> = []
  for (const step of steps) {
    if (step.kind === "thinking" && !thinking) continue
    if (step.kind === "tool" || step.kind === "thinking") {
      const last = segments.at(-1)
      if (Array.isArray(last)) last.push(step)
      else segments.push([step])
    } else segments.push(step)
  }
  const lastRun = segments.findLastIndex((segment) => Array.isArray(segment))
  return segments.flatMap((segment, i) => (Array.isArray(segment) ? runItems(segment, live && i === lastRun) : [itemOf(segment)]))
}

/** A turn is what the agent does after a prompt, up to its answer: a new one starts at a prompt, and right after an answer. */
const turnsOf = (steps: ReadonlyArray<LogStep>): ReadonlyArray<ReadonlyArray<LogStep>> => {
  const turns: LogStep[][] = []
  let current: LogStep[] = []
  let answered = false
  for (const step of steps) {
    if ((step.kind === "user" || answered) && current.length > 0) {
      turns.push(current)
      current = []
    }
    current.push(step)
    answered = step.endsTurn === true
  }
  if (current.length > 0) turns.push(current)
  return turns
}

/** When a step was over: its time, plus how long its call took. */
const endOf = (step: LogStep): number | null => (step.at === null ? null : step.at + (step.tool?.durationMs ?? 0))

/**
 * The Story view (CEL-170): prompts and messages, with the calls between them folded into groups, a call
 * still running as its own live row, and a turn that ended folded to "Worked for 4 min 12 s" with its answer
 * left open. A turn has ended when it holds an answer (`endsTurn`), another turn follows, or the agent isn't
 * working (`live` false); the one still going shows flat.
 */
export const storyOf = (steps: ReadonlyArray<LogStep>, options: { readonly thinking: boolean; readonly live: boolean }): ReadonlyArray<StoryItem> => {
  const { thinking, live } = options
  const turns = turnsOf(steps)
  return turns.flatMap((turn, i): ReadonlyArray<StoryItem> => {
    const head = turn[0]?.kind === "user" ? turn[0] : null
    const body = head ? turn.slice(1) : turn
    const headItems = head ? [itemOf(head)] : []
    const ended = i < turns.length - 1 || !live || turn.some((step) => step.endsTurn === true)
    if (!ended) return [...headItems, ...itemsOf(body, thinking, true)]
    // Up to the last message is the work; that message is the answer, and anything after it stays out of the fold.
    const answerAt = body.findLastIndex((step) => step.kind === "message")
    const answer = answerAt < 0 ? null : body[answerAt]!
    const work = answerAt < 0 ? body : body.slice(0, answerAt)
    const workItems = itemsOf(work, thinking, false)
    const start = (head ?? turn[0]!).at
    const end = answer ? answer.at : endOf(turn.at(-1)!)
    const folded: ReadonlyArray<StoryItem> = work.some(isCall)
      ? [{ _tag: "turn", id: `turn:${work[0]!.id}`, durationMs: start === null || end === null ? null : Math.max(0, end - start), items: workItems }]
      : workItems
    return [...headItems, ...folded, ...(answer ? [itemOf(answer), ...itemsOf(body.slice(answerAt + 1), thinking, false)] : [])]
  })
}

/** The item's key: its step's id, or its group's or turn's. */
export const storyKey = (item: StoryItem): string => (item._tag === "group" || item._tag === "turn" ? item.id : item.step.id)

/** Every step an item holds. */
export const storySteps = (item: StoryItem): ReadonlyArray<LogStep> =>
  item._tag === "group" ? item.steps : item._tag === "turn" ? item.items.flatMap(storySteps) : [item.step]

/** "Worked for 4 min 12 s"; "Worked" when the time isn't known. */
export const workedWords = (ms: number | null): string => (ms === null ? "Worked" : `Worked for ${durationWords(ms)}`)

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

/**
 * What `cello agents` says the agent is doing now: its test run while it runs ("Running tests: web e2e 7
 * of 13 · 1 failed · 3m12s", CEL-134), else currentStepOf.
 */
export const doingNowOf = (
  row: { readonly presence: Presence; readonly agent: SessionAgent | null; readonly session: AgentSession },
  now: number,
): string | null => {
  const run = (row.agent ? row.agent.tests : row.session.tests) ?? null
  if (row.presence !== "ended" && isRunning(run, now)) return `Running tests: ${testRunWords(run!, now)}`
  return currentStepOf(row)
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
