// The Claude Code side of `cello hook claude <event>` (CEL-15). Claude Code runs the hook with a JSON
// object on stdin and reads a JSON object from stdout on exit 0; formats from
// https://code.claude.com/docs/en/hooks (checked 2026-11-15):
//
//   stdin   { session_id, cwd, hook_event_name, stop_hook_active (Stop), agent_id (inside a subagent), … }
//   both    { "hookSpecificOutput": { "hookEventName": "Stop" | "PostToolUse", "additionalContext": "…" } }
//
// On Stop, additionalContext "keeps the conversation going through the same loop protections as
// `decision: "block"` … but the transcript labels it `Stop hook feedback` and no hook error
// notification is shown". Printing nothing and exiting 0 lets the session carry on as if there were no hook.
import type { Env } from "./identity.ts"

export const HOOK_EVENTS = ["stop", "post-tool-use"] as const
export type HookEvent = (typeof HOOK_EVENTS)[number]

/** How long the hook waits for the server before giving up silently (Claude Code's own limit is HOOK_TIMEOUT). */
export const HOOK_DEADLINE_MS = 2000

/** The deadline: HOOK_DEADLINE_MS, or CELLO_HOOK_DEADLINE_MS (tests shorten it). */
export const hookDeadline = (env: Env): number => Number(env.CELLO_HOOK_DEADLINE_MS) || HOOK_DEADLINE_MS

export interface HookInput {
  /** Claude Code's session id: the session the comments are for. */
  readonly sessionId: string | null
  readonly cwd: string | null
  /** Stop only: Claude is already continuing because a Stop hook blocked. */
  readonly stopHookActive: boolean
  /** The event fired inside a subagent (its input carries `agent_id`); comments go to the main conversation. */
  readonly inSubagent: boolean
}

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null)

/** Reads the hook's stdin. Empty or broken input means no information, never an error. */
export const parseHookInput = (raw: string): HookInput => {
  let value: unknown = null
  try {
    value = JSON.parse(raw)
  } catch {
    // Not JSON: nothing to go on.
  }
  const input = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    sessionId: text(input.session_id),
    cwd: text(input.cwd),
    stopHookActive: input.stop_hook_active === true,
    inSubagent: text(input.agent_id) !== null,
  }
}

/** The session to deliver to: stdin's `session_id`, else CLAUDE_CODE_SESSION_ID. */
export const hookSession = (input: HookInput, env: Env): string | null => input.sessionId ?? text(env.CLAUDE_CODE_SESSION_ID)

/** What the hook prints when comments arrived: context the agent acts on (on Stop, it keeps the agent going). */
export const hookResponse = (event: HookEvent, delivery: string) => ({
  hookSpecificOutput: { hookEventName: event === "stop" ? "Stop" as const : "PostToolUse" as const, additionalContext: delivery },
})
