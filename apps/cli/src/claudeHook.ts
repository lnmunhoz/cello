// The Claude Code side of `cello hook claude <event>` (CEL-15). Claude Code runs the hook with a JSON
// object on stdin and reads a JSON object from stdout on exit 0; formats from
// https://code.claude.com/docs/en/hooks (checked 2026-11-15):
//
//   stdin   { session_id, cwd, hook_event_name, stop_hook_active (Stop), agent_id (inside a subagent),
//             tool_name, tool_input (PreToolUse, PostToolUse), … }
//   both    { "hookSpecificOutput": { "hookEventName": "Stop" | "PostToolUse", "additionalContext": "…" } }
//   pre     { "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "…" } }
//
// On Stop, additionalContext "keeps the conversation going through the same loop protections as
// `decision: "block"` … but the transcript labels it `Stop hook feedback` and no hook error
// notification is shown". Printing nothing and exiting 0 lets the session carry on as if there were no hook.
// On PreToolUse, a deny "blocks the tool call, and shows Claude the reason" (CEL-57: the artifact guard).
import { isObject } from "./claudeSettings.ts"
import type { Env } from "./identity.ts"

export const HOOK_EVENTS = ["stop", "post-tool-use", "pre-tool-use"] as const
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
  /** PreToolUse and PostToolUse: the tool being called (`Artifact`, `Bash`, …). */
  readonly toolName: string | null
  /** Its arguments, when they're an object. */
  readonly toolInput: Readonly<Record<string, unknown>> | null
}

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null)

const record = (value: unknown) => (isObject(value) ? value : null)

/** Reads the hook's stdin. Empty or broken input means no information, never an error. */
export const parseHookInput = (raw: string): HookInput => {
  let value: unknown = null
  try {
    value = JSON.parse(raw)
  } catch {
    // Not JSON: nothing to go on.
  }
  const input = record(value) ?? {}
  return {
    sessionId: text(input.session_id),
    cwd: text(input.cwd),
    stopHookActive: input.stop_hook_active === true,
    inSubagent: text(input.agent_id) !== null,
    toolName: text(input.tool_name),
    toolInput: record(input.tool_input),
  }
}

/** The session to deliver to: stdin's `session_id`, else CLAUDE_CODE_SESSION_ID. */
export const hookSession = (input: HookInput, env: Env): string | null => input.sessionId ?? text(env.CLAUDE_CODE_SESSION_ID)

// ── the artifact guard (CEL-57) ─────────────────────────────────────────────────────────────────
// In a Cello project, what an agent shows Lucas goes into Cello as a page, never a claude.ai artifact.
// `cello install claude` puts a PreToolUse hook on the `Artifact` tool into the project's settings; it
// turns publishes away and lets everything else (read, list, open, delete, pin, quickstart) through.

/** The env var that lets artifact publishes through, for when Lucas asks for a Claude artifact by name. */
export const ALLOW_ARTIFACTS_VARIABLE = "CELLO_ALLOW_ARTIFACTS"

/** What the agent reads when its publish is turned away: what to do instead. */
export const ARTIFACT_DENY_REASON =
  "This project uses Cello. Show it as a Cello page: `cello doc publish page.md --task KEY-n` (images inline, videos with --asset), " +
  "then open it in Cello's panel: open \"cello://open?url=<url-encoded page link>\". " +
  "Claude artifacts are only for when Lucas asks for one by name; if he did, tell him this project's Cello hook stopped it " +
  `(he can allow them by starting Claude Code with ${ALLOW_ARTIFACTS_VARIABLE}=1).`

/**
 * Whether an Artifact call publishes: no action (the tool's default is publish) or "publish", which
 * also covers uploading files and assets and creating from a type. Anything else, including an action
 * this code doesn't know yet, isn't one.
 */
const publishes = (toolInput: Readonly<Record<string, unknown>>) => toolInput.action == null || toolInput.action === "publish"

/**
 * The PreToolUse hook's answer: a deny for an Artifact publish, else null (print nothing, the call
 * goes ahead). Never fails closed: input it can't read, another tool, or the opt-out all mean null.
 */
export const artifactGuard = (input: HookInput, env: Env) => {
  if (env[ALLOW_ARTIFACTS_VARIABLE] === "1") return null
  if (input.toolName !== "Artifact" || input.toolInput === null || !publishes(input.toolInput)) return null
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "deny" as const,
      permissionDecisionReason: ARTIFACT_DENY_REASON,
    },
  }
}

/** What the hook prints when comments arrived: context the agent acts on (on Stop, it keeps the agent going). */
export const hookResponse = (event: Exclude<HookEvent, "pre-tool-use">, delivery: string) => ({
  hookSpecificOutput: { hookEventName: event === "stop" ? "Stop" as const : "PostToolUse" as const, additionalContext: delivery },
})
