// What an agent is doing besides its last tool call, kept pure (CEL-133). A subagent can end its turn
// while background work it started is still running (a Docker e2e run with run_in_background, a Monitor
// watching it): Claude Code fires SubagentStop, then resumes the agent when that work ends. So each
// piece of background work an agent starts is remembered (from PostToolUse: Bash's `backgroundTaskId`,
// Monitor's `taskId`), and a stop compares it with the session's `background_tasks`: while some of its
// own work runs, the agent is waiting on it, not finished.

/** One piece of background work an agent started: Claude Code's task id, and the call in one line. */
export interface BackgroundWork {
  readonly id: string
  readonly label: string
  readonly toolUseId: string | null
}

/** How many pieces of background work are remembered per agent: the newest. */
export const MAX_BACKGROUND = 20

/** `list` with `work` added (replacing one with its id), newest last, the newest MAX_BACKGROUND kept. */
export const withBackground = (list: ReadonlyArray<BackgroundWork>, work: BackgroundWork): ReadonlyArray<BackgroundWork> =>
  [...list.filter((w) => w.id !== work.id), work].slice(-MAX_BACKGROUND)

export interface StopOutcome {
  /** No work of its own is left running: the agent is done. */
  readonly finished: boolean
  /** Its work still running, which is all that's worth remembering after a stop. */
  readonly background: ReadonlyArray<BackgroundWork>
  /** What it waits on, one line each; null when it isn't waiting. */
  readonly waitingOn: ReadonlyArray<string> | null
}

const FINISHED: StopOutcome = { finished: true, background: [], waitingOn: null }

/**
 * What a stop means for an agent that started `background`, given the ids the session still runs
 * (SubagentStop's `background_tasks`, which lists the whole session's: the parent's and other agents'
 * too). Unknown (`undefined`, an older Claude Code) finishes it, as stops always did.
 */
export const stopOutcome = (background: ReadonlyArray<BackgroundWork>, running: ReadonlyArray<string> | undefined): StopOutcome => {
  if (running === undefined) return FINISHED
  const live = new Set(running)
  const own = background.filter((w) => live.has(w.id))
  return own.length === 0 ? FINISHED : { finished: false, background: own, waitingOn: own.map((w) => w.label) }
}

const isWork = (value: unknown): value is BackgroundWork => {
  if (value === null || typeof value !== "object") return false
  const w = value as Record<string, unknown>
  return typeof w.id === "string" && typeof w.label === "string" && (w.toolUseId === null || typeof w.toolUseId === "string")
}

/** JSON that may be missing or broken: null for either. */
const parsed = (json: string | null | undefined): unknown => {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/** The stored `background_json`; anything it can't read is none. */
export const parseBackground = (json: string | null | undefined): ReadonlyArray<BackgroundWork> => {
  const value = parsed(json)
  return Array.isArray(value) ? value.filter(isWork) : []
}

/** The stored `waiting_json` as the entity's `waitingOn`; anything it can't read, or an empty list, is null. */
export const parseWaiting = (json: string | null | undefined): ReadonlyArray<string> | null => {
  const value = parsed(json)
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string") ? value : null
}

/** A list as stored: JSON, or null for an empty or missing one. */
export const stored = (list: ReadonlyArray<unknown> | null): string | null => (list === null || list.length === 0 ? null : JSON.stringify(list))
