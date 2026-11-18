// An agent's live log (CEL-106): the steps `agent.log` streams for one agent session, one of its
// subagents, or one run Cello woke. The server reads them from Claude Code's own transcript (or the run's
// log), parses each JSON line into steps and follows new lines while the stream is open. Nothing here is
// stored: the transcript stays Claude Code's.
import * as Schema from "effect/Schema"

/**
 * The log's defaults, one switch each (the human's answers on CEL-106, Nov 16):
 * - `resultPreviewLines`: a tool result opens to this many lines, then "Show all"; folded to one line before that
 * - `thinking`: the agent's thinking is hidden until the "Thinking" switch shows it, folded like a result
 * - `finishedLogs`: an agent that finished still opens its log, while its transcript is on disk
 * - `show`: the log opens on its Story view (calls grouped, finished turns folded), not on every call (the human's answer on CEL-170, Nov 18)
 */
export const LOG_DEFAULTS = {
  resultPreviewLines: 200,
  thinking: false,
  finishedLogs: true,
  show: "story",
} as const

/**
 * What a step is: what the agent said (`message`), what it was told (`user`: the human's prompt, or a
 * parent's brief), its `thinking`, a `tool` call with its result, a subagent it launched (`agent`), or a
 * note from the run around it (`system`: a woken run's start and end, a line it couldn't parse).
 */
export const LogStepKind = Schema.Literals(["message", "user", "thinking", "tool", "agent", "system"])
export type LogStepKind = typeof LogStepKind.Type

/** A tool call: `running` until its result arrives, then `ok` or `error`. */
export const ToolStatus = Schema.Literals(["running", "ok", "error"])
export type ToolStatus = typeof ToolStatus.Type

export const ToolCall = Schema.Struct({
  name: Schema.String,
  status: ToolStatus,
  /** From the call's timestamp to its result's; null when either is unknown. */
  durationMs: Schema.NullOr(Schema.Number),
  /** The command a Bash or Monitor call ran, keys masked, up to MAX_COMMAND_CHARS; its line shows Claude's description instead (CEL-170). */
  command: Schema.optionalKey(Schema.String),
  /** The result's text, up to MAX_OUTPUT_LINES lines and MAX_OUTPUT_CHARS characters. */
  output: Schema.String,
  /** How many lines the whole result had. */
  lines: Schema.Number,
  /** The result was longer than what `output` holds. */
  cut: Schema.Boolean,
})
export type ToolCall = typeof ToolCall.Type

export const LogStep = Schema.Struct({
  /** Stable across updates: a tool call's id, or the transcript line's uuid. A step sent again replaces the one with its id. */
  id: Schema.String,
  kind: LogStepKind,
  /** When it happened (ms); null when the source doesn't say (a woken run's stream). */
  at: Schema.NullOr(Schema.Number),
  /** The words for messages, prompts and thinking; for a tool call or a launch, its one line ("Bash · bun run test"). */
  text: Schema.String,
  tool: Schema.optionalKey(ToolCall),
  /** A launch (`agent`): the subagent's id once its result names it, so the page can link its row. */
  agentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** Something in it looked like a key or token and is masked; the human can ask to see it. */
  masked: Schema.optionalKey(Schema.Boolean),
  /** A message that ended the agent's turn (Claude Code's `stop_reason: end_turn`): its answer before it waits (CEL-170). */
  endsTurn: Schema.optionalKey(Schema.Boolean),
})
export type LogStep = typeof LogStep.Type

/**
 * Why there's no log: no hook has reported a transcript for this agent yet (`none`), the file isn't on
 * disk (`missing`: Claude Code cleaned it up, or it hasn't been written yet), or the path a hook reported
 * is outside Claude Code's `projects/` folder, so Cello won't read it (`refused`), or the file is there
 * but couldn't be read (`unreadable`: its permissions, say); the stream ends after `refused` and `unreadable`.
 */
export const LogUnavailable = Schema.Literals(["none", "missing", "refused", "unreadable"])
export type LogUnavailable = typeof LogUnavailable.Type

/**
 * What the stream sends. `steps`: new steps, or new versions of steps already sent (a tool call whose
 * result arrived); `reset` means drop what was shown first (the first batch, or a file that was
 * replaced); `skipped` how many older steps the first batch left out, and `older` that a long transcript
 * was read only from near its end, so there are earlier steps it didn't count. `unavailable`: there's no log now.
 */
export const LogUpdate = Schema.Union([
  Schema.TaggedStruct("steps", {
    steps: Schema.Array(LogStep),
    reset: Schema.Boolean,
    skipped: Schema.Number,
    older: Schema.optionalKey(Schema.Boolean),
    /** How many thoughts so far Claude Code wrote without their words (only a signature: its `showThinkingSummaries` setting was off); absent when none (CEL-170). */
    unsavedThinking: Schema.optionalKey(Schema.Number),
  }),
  Schema.TaggedStruct("unavailable", { reason: LogUnavailable }),
])
export type LogUpdate = typeof LogUpdate.Type

/** The most lines of a tool result the stream carries. */
export const MAX_OUTPUT_LINES = 400
/** The most characters of a tool result the stream carries. */
export const MAX_OUTPUT_CHARS = 40_000
/** The most characters of a Bash command the stream carries. */
export const MAX_COMMAND_CHARS = 4_000
/** The first batch sends at most this many of the newest steps. */
export const MAX_FIRST_STEPS = 300
