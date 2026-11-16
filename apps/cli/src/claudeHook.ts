// The Claude Code side of `cello hook claude <event>` (CEL-15). Claude Code runs the hook with a JSON
// object on stdin and reads a JSON object from stdout on exit 0; formats from
// https://code.claude.com/docs/en/hooks (checked 2026-11-15):
//
//   stdin   { session_id, cwd, hook_event_name, stop_hook_active (Stop), agent_id and agent_type (inside a
//             subagent, and on SubagentStart/SubagentStop), tool_name, tool_input (PreToolUse, PostToolUse),
//             tool_response (PostToolUse; on the Agent tool it has the launched subagent's agentId),
//             background_tasks: [{ id, type: "shell" | …, status, command (shell only) }] (Stop), … }
//   start   { "hookSpecificOutput": { "hookEventName": "SubagentStart", "additionalContext": "…" } }
//   both    { "hookSpecificOutput": { "hookEventName": "Stop" | "PostToolUse", "additionalContext": "…" } }
//   pre     { "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "…" } }
//
// On Stop, additionalContext "keeps the conversation going through the same loop protections as
// `decision: "block"` … but the transcript labels it `Stop hook feedback` and no hook error
// notification is shown". Printing nothing and exiting 0 lets the session carry on as if there were no hook.
// The Stop nudge to start `cello inbox --wait` (CEL-74) uses the same additionalContext form, since it is
// guidance, not an error; `decision: "block"` with a `reason` would keep the session going the same way
// but show as a hook error (checked 2026-11-16).
// On PreToolUse, a deny "blocks the tool call, and shows Claude the reason" (CEL-57: the artifact
// guard; CEL-61: the claim guard; CEL-124: the AskUserQuestion guard).
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { isObject } from "./claudeSettings.ts"
import { andList } from "./format.ts"
import { agentVariable, type Env } from "./identity.ts"

export const HOOK_EVENTS = ["stop", "post-tool-use", "pre-tool-use", "subagent-start", "subagent-stop"] as const
export type HookEvent = (typeof HOOK_EVENTS)[number]
/** The events that hand comments over (CEL-15). */
export type DeliveryEvent = "stop" | "post-tool-use"

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
  /** That subagent (CEL-55): `agent_id`, and `agent_type` when given. SubagentStart and SubagentStop name the one starting or stopping. */
  readonly agent: HookAgent | null
  /** PostToolUse on the Agent tool: the subagent it launched (CEL-55), when the response names it. */
  readonly launched: Launch | null
  /** PreToolUse and PostToolUse: the tool being called (`Artifact`, `Bash`, …). */
  readonly toolName: string | null
  /** Its arguments, when they're an object. */
  readonly toolInput: Readonly<Record<string, unknown>> | null
  /**
   * Stop only: the commands of the shells the session runs in the background (`background_tasks`);
   * null when Claude Code didn't send the list (an older version, or another event).
   */
  readonly backgroundCommands: ReadonlyArray<string> | null
  /** The session's permission mode (`permission_mode`, every event): a woken run continues in it (CEL-92). */
  readonly permissionMode: string | null
}

export interface HookAgent {
  readonly id: string
  readonly type: string | null
}

/** A subagent the Agent tool launched: `tool_response.agentId`, and what `tool_input` asked for. */
export interface Launch {
  readonly agentId: string
  readonly agentType: string
  readonly description: string | null
  readonly prompt: string | null
}

/** The Agent tool's names: `Agent`, and `Task` before Claude Code renamed it. */
const AGENT_TOOLS = new Set(["Agent", "Task"])

/** What Claude Code runs when the Agent tool names no `subagent_type`. */
const DEFAULT_AGENT_TYPE = "general-purpose"

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null)

const record = (value: unknown) => (isObject(value) ? value : null)

const launchOf = (toolName: string | null, toolInput: Readonly<Record<string, unknown>> | null, toolResponse: unknown): Launch | null => {
  const agentId = text(record(toolResponse)?.agentId)
  if (toolName === null || !AGENT_TOOLS.has(toolName) || agentId === null) return null
  return {
    agentId,
    agentType: text(toolInput?.subagent_type) ?? DEFAULT_AGENT_TYPE,
    description: text(toolInput?.description),
    prompt: text(toolInput?.prompt),
  }
}

/** Reads the hook's stdin. Empty or broken input means no information, never an error. */
export const parseHookInput = (raw: string): HookInput => {
  let value: unknown = null
  try {
    value = JSON.parse(raw)
  } catch {
    // Not JSON: nothing to go on.
  }
  const input = record(value) ?? {}
  const agentId = text(input.agent_id)
  const toolName = text(input.tool_name)
  const toolInput = record(input.tool_input)
  return {
    sessionId: text(input.session_id),
    cwd: text(input.cwd),
    stopHookActive: input.stop_hook_active === true,
    inSubagent: agentId !== null,
    agent: agentId === null ? null : { id: agentId, type: text(input.agent_type) },
    launched: launchOf(toolName, toolInput, input.tool_response),
    toolName,
    toolInput,
    backgroundCommands: Array.isArray(input.background_tasks)
      ? input.background_tasks.flatMap((task) => {
        const command = text(record(task)?.command)
        return command === null ? [] : [command]
      })
      : null,
    permissionMode: text(input.permission_mode),
  }
}

/** The session to deliver to: stdin's `session_id`, else CLAUDE_CODE_SESSION_ID. */
export const hookSession = (input: HookInput, env: Env): string | null => input.sessionId ?? text(env.CLAUDE_CODE_SESSION_ID)

/**
 * The environment the hook's own calls are made as: the session from stdin (never CELLO_SESSION, which
 * would be the human's "me"), and inside a subagent that agent as CELLO_AGENT (CEL-55). In the main
 * conversation CELLO_AGENT is dropped, whatever the environment had.
 */
export const hookIdentity = (input: HookInput, env: Env): Env => {
  const { CELLO_SESSION: _session, CELLO_AGENT: _agent, CELLO_PERMISSION_MODE: _mode, ...rest } = env
  const session = hookSession(input, env)
  return {
    ...rest,
    ...(session ? { CLAUDE_CODE_SESSION_ID: session } : {}),
    ...(input.agent ? { CELLO_AGENT: agentVariable(input.agent) } : {}),
    // Its permission mode, as the hook was told it (CEL-92): what a woken run of it uses.
    ...(input.permissionMode ? { CELLO_PERMISSION_MODE: input.permissionMode } : {}),
  }
}

/**
 * SubagentStart's answer (CEL-55): context for the new subagent. Its Bash can't see its own agent id,
 * so it's told the `--agent` to give its `cello` commands; then the board credits its comments and
 * changes to it, under the session. A flag rather than a CELLO_AGENT=… prefix (CEL-90): Claude Code's
 * allow rule Bash(cello:*) only matches commands that start with `cello`.
 */
export const subagentContext = (agent: HookAgent) => {
  const value = agentVariable(agent)
  return {
    hookSpecificOutput: {
      hookEventName: "SubagentStart" as const,
      additionalContext:
        `Cello: you are subagent \`${value}\` of this Claude Code session. Give every \`cello\` command you run \`--agent ${value}\` ` +
        `(e.g. \`cello --agent ${value} task comment CEL-1 "…"\`), so the board credits your comments and changes to you, not to the main conversation. ` +
        "Keep your commands starting with `cello` (no variables in front): that's what lets them skip Claude Code's permission check. " +
        "Claims and comments for the session stay with the main conversation: don't run `cello inbox`.",
    },
  }
}

/**
 * What the hook does for this input. In the main conversation it hands over new comments (which also
 * checks the session in). Inside a subagent the comments stay for the main conversation, but the
 * subagent works for the session, so it still checks in: the board shows the task as being worked on
 * while a builder subagent runs (CEL-35).
 */
export const hookAction = (input: HookInput, env: Env): "deliver" | "check-in" | "nothing" =>
  hookSession(input, env) === null ? "nothing" : input.inSubagent ? "check-in" : "deliver"

// ── the artifact guard (CEL-57) ─────────────────────────────────────────────────────────────────
// In a Cello project, what an agent shows Lucas goes into Cello as a page, never a claude.ai artifact.
// `cello install claude` puts a PreToolUse hook on the `Artifact` tool into the project's settings; it
// turns publishes away and lets everything else (read, list, open, delete, pin, quickstart) through.

/** The env var that lets artifact publishes through, for when Lucas asks for a Claude artifact by name. */
export const ALLOW_ARTIFACTS_VARIABLE = "CELLO_ALLOW_ARTIFACTS"

/** What the agent reads when its publish is turned away: what to do instead. */
export const ARTIFACT_DENY_REASON =
  "This project uses Cello. Show it as a Cello page: `cello doc publish page.md --task KEY-n` (images inline, videos with --asset), " +
  "then open it in Cello's panel with `cello open <slug>`. " +
  "In your reply, link the page with the cello:// link those commands print, never its http address: an http link opens Claude's own browser, not Cello. " +
  "Claude artifacts are only for when the human asks for one by name; if they did, tell them this project's Cello hook stopped it " +
  `(they can allow them by starting Claude Code with ${ALLOW_ARTIFACTS_VARIABLE}=1).`

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
  return preToolDeny(ARTIFACT_DENY_REASON)
}

// ── the AskUserQuestion guard (CEL-124) ─────────────────────────────────────────────────────────
// In a Cello project, a question for the human goes on the card (`cello task ask`), where the task
// moves to Needs input and the answer wakes the session. Claude's own AskUserQuestion dialog blocks the
// session until it's answered, with the card saying only "idle" and the human's comments queued behind
// it (Nov 16: 40 minutes, after a refused ask on a Done task). The same PreToolUse hook denies every
// call to it, with the way to ask on the card instead.

/** The env var that lets AskUserQuestion through, for when the human asks for questions in the terminal. */
export const ALLOW_ASK_USER_VARIABLE = "CELLO_ALLOW_ASK_USER"

/** What the agent reads when its question is turned away: where to ask instead. */
export const ASK_USER_DENY_REASON =
  "This project uses Cello: questions for the human go on the card, never in Claude's own window, which blocks this session until it's answered. " +
  "Ask with `cello task ask KEY-n --file ask.yaml --wait`, run in the background (the Bash tool with run_in_background: true): " +
  "the task moves to Needs input and the answers come back to you. " +
  "If no open task you hold fits the question (yours was approved, or it's a new decision), create one: " +
  "`cello task create \"<the decision>\" --status Todo`, claim it with `cello task claim KEY-n`, and ask there. " +
  "Terminal questions are only for when the human asks for them; if they did, tell them this project's Cello hook stopped it " +
  `(they can allow them by starting Claude Code with ${ALLOW_ASK_USER_VARIABLE}=1).`

/**
 * The PreToolUse hook's answer for AskUserQuestion: always a deny, whatever it asks. Never fails
 * closed: input it can't read, another tool, or the opt-out all mean null.
 */
export const askUserGuard = (input: HookInput, env: Env) => {
  if (env[ALLOW_ASK_USER_VARIABLE] === "1") return null
  if (input.toolName !== "AskUserQuestion") return null
  return preToolDeny(ASK_USER_DENY_REASON)
}

/** A PreToolUse answer that blocks the call and shows Claude `reason`. */
const preToolDeny = (reason: string) => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse" as const,
    permissionDecision: "deny" as const,
    permissionDecisionReason: reason,
  },
})

// ── the claim guard (CEL-61) ────────────────────────────────────────────────────────────────────
// Every request from Lucas that changes something starts as a Cello task. The same PreToolUse hook
// runs before Claude Code's file-editing tools and turns an edit inside the repo away while the
// session holds no claimed task in the repo's project. It asks the server (`task.list --mine`), so
// unlike the artifact guard it needs one; when the server is down, slow, or the repo isn't a Cello
// project, the edit goes through: the guard nudges, it never stops work.

/** The env var that lets every edit through, for when Lucas wants to work without tasks. */
export const ALLOW_UNTRACKED_VARIABLE = "CELLO_ALLOW_UNTRACKED"

/** Claude Code's tools that write files, and the input field that names the file. */
const EDIT_TOOLS: Readonly<Record<string, string>> = { Edit: "file_path", Write: "file_path", NotebookEdit: "notebook_path" }

/** What the agent reads when its edit is turned away. */
export const claimDenyReason = (projectKey: string) =>
  `Cello: this session hasn't claimed a task in ${projectKey}. Before editing for a request, check it exists (\`cello task list\`), ` +
  `else \`cello task create "<title>"\` with the human's words, then \`cello task claim ${projectKey}-n\`.`

export interface ClaimCheck {
  /** The agent session whose claims count (subagents share their parent's). */
  readonly session: string
  /** The session's folder, which says the repo and so the project. */
  readonly cwd: string
  /** The file the tool would write, absolute. */
  readonly file: string
}

/**
 * Whether this call needs the server's answer: an edit tool with a file path, in an agent session,
 * without the opt-out. `fallbackCwd` is the hook's own folder, for input without `cwd`. Null means
 * the call goes ahead without asking.
 */
export const claimCheck = (input: HookInput, env: Env, fallbackCwd: string): ClaimCheck | null => {
  if (env[ALLOW_UNTRACKED_VARIABLE] === "1") return null
  const field = input.toolName === null ? undefined : EDIT_TOOLS[input.toolName]
  if (field === undefined || input.toolInput === null) return null
  const target = text(input.toolInput[field])
  const session = hookSession(input, env)
  if (target === null || session === null) return null
  const cwd = input.cwd ?? fallbackCwd
  return { session, cwd, file: path.resolve(cwd, target) }
}

/** `file` with symlinks resolved as far as it exists (a new file's folder may not exist yet). */
const resolved = (file: string): string => {
  const absolute = path.resolve(file)
  try {
    return fs.realpathSync(absolute)
  } catch {
    const parent = path.dirname(absolute)
    return parent === absolute ? absolute : path.join(resolved(parent), path.basename(absolute))
  }
}

/** Whether `file` is one of `roots` or inside one, symlinks resolved; null roots are skipped. */
export const insideAny = (file: string, roots: ReadonlyArray<string | null>): boolean => {
  const target = resolved(file)
  return roots.some((root) => {
    if (root === null) return false
    const relative = path.relative(resolved(root), target)
    // "..foo" is a folder inside; only ".." itself or "../…" climbs out.
    const climbs = relative === ".." || relative.startsWith(`..${path.sep}`)
    return !climbs && !path.isAbsolute(relative)
  })
}

/** The hook's answer once the server said how many open tasks the session holds in the project: null lets the edit through. */
export const claimAnswer = (result: { readonly projectKey: string; readonly claimed: number }) =>
  result.claimed > 0 ? null : preToolDeny(claimDenyReason(result.projectKey))

/** How long a claim the server reported lets edits through without asking again. */
export const CLAIM_CACHE_MS = 60_000

/**
 * A remembered "this session holds a claim here", one small file per server, repo and session in
 * `dir` holding when it was seen. Only claims are remembered: after a deny, the next edit asks again,
 * so claiming takes effect at once. Reading or writing it never throws; trouble just means no cache.
 */
export const claimCache = (dir: string, key: { readonly port: string; readonly repoPath: string; readonly session: string }) => {
  const name = new Bun.CryptoHasher("sha256").update(`${key.port}\0${key.repoPath}\0${key.session}`).digest("hex").slice(0, 32)
  const file = path.join(dir, name)
  return {
    file,
    fresh: (now: number): boolean => {
      try {
        const seen = Number(fs.readFileSync(file, "utf8"))
        // A time after now (a clock set back) isn't trusted.
        return Number.isFinite(seen) && seen > 0 && seen <= now && now - seen < CLAIM_CACHE_MS
      } catch {
        return false
      }
    },
    remember: (now: number): void => {
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
        fs.writeFileSync(file, String(now), { mode: 0o600 })
        fs.chmodSync(file, 0o600)
      } catch {
        // No cache, then.
      }
    },
  }
}

/** Where the claim cache lives: a folder under the system's temp folder (TMPDIR when set). */
export const claimCacheDir = (env: Env) => path.join(env.TMPDIR || os.tmpdir(), "cello-claims")

// ── waiting while idle (CEL-74) ─────────────────────────────────────────────────────────────────
// The hooks only fire while the session works, so a session that ended its turn never hears its human.
// `cello inbox --wait`, run in the background, wakes it instead. When a session holding a claim stops
// and nothing is waiting for it, the Stop hook keeps it going once to start one; a Stop that hands
// comments over says the same in a line at the end, since the stop after it won't be nudged. It never
// loops: a stop Claude makes because a Stop hook kept it going (`stop_hook_active`) goes through, and
// so does any stop it can't judge (a lock it can't read, a subagent, no server, past the deadline).

/** What the agent reads when it's asked to start a waiter: which claims, what to run, and how. */
export const WAIT_NUDGE = (claimed: ReadonlyArray<string>, human: string) =>
  `Cello: you hold ${claimed.length === 1 ? "a claim on" : "claims on"} ${andList(claimed)}, and nothing is waiting for ${human}'s comments, ` +
  `so once this turn ends ${human} can't reach you. Start \`cello inbox --wait\` in the background now (the Bash tool with run_in_background: true), ` +
  `then end your turn. It wakes you when ${human} comments, sends a task back or answers your questions.`

/** The line added to a Stop delivery when nothing waits for the session. */
export const WAIT_HINT = (human: string) =>
  `When you end this turn, start \`cello inbox --wait\` in the background first (the Bash tool with run_in_background: true), so ${human}'s next comment wakes you.`

/** Shell words, split at `&&`, `||`, `;` and `|`: enough to read a command line, not a shell. */
const commandsOf = (line: string): string[][] =>
  line.split(/&&|\|\||;|\|/).map((part) => part.trim().split(/\s+/).filter((word) => word !== "").map((word) => word.replace(/^["']|["']$/g, "")))

/**
 * Whether one of the session's background shells (Stop's `background_tasks`) runs `cello inbox --wait`:
 * a command whose program is `cello` (after any VAR=value), then `inbox`, with `--wait` among its flags.
 */
export const waitsInBackground = (input: HookInput): boolean =>
  (input.backgroundCommands ?? []).some((line) =>
    commandsOf(line).some((words) => {
      const [program, sub, ...rest] = words.slice(words.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)))
      return program !== undefined && path.basename(program) === "cello" && sub === "inbox" && rest.includes("--wait")
    }))

export type WaiterLock = "running" | "absent" | "unknown"

/**
 * Whether a waiter runs for the session. A background shell running it counts. When Claude Code lists
 * its background shells and none is a waiter, a live lock doesn't count either: it belongs to a waiter
 * that outlived its session, or to a reused pid. Without the list, the lock decides.
 */
export const waiterState = (input: HookInput, lock: WaiterLock): WaiterLock => {
  if (waitsInBackground(input)) return "running"
  if (input.backgroundCommands !== null && lock === "running") return "absent"
  return lock
}

/** The variable a run Cello woke (CEL-92) has: it answers and exits, so it never starts a waiter. */
export const WOKEN_VARIABLE = "CELLO_WOKEN"

/**
 * What the Stop hook knows: the tasks the session holds, its lock, the human's name, and whether this
 * is a run Cello woke (CELLO_WOKEN=1, CEL-92), which is never asked for a waiter: it would keep the run
 * alive for nothing, and Cello wakes it again when Lucas next acts.
 */
export interface StopFacts {
  readonly claimed: ReadonlyArray<string>
  readonly waiter: WaiterLock
  readonly human: string
  readonly woken?: boolean
}

const needsWaiter = (input: HookInput, facts: StopFacts) =>
  !input.inSubagent && !facts.woken && facts.claimed.length > 0 && waiterState(input, facts.waiter) === "absent"

/**
 * The Stop hook's answer when nothing new arrived: keep the session going once to start a waiter, or
 * null to let it stop.
 */
export const stopNudge = (input: HookInput, facts: StopFacts) =>
  !input.stopHookActive && needsWaiter(input, facts) ? hookResponse("stop", WAIT_NUDGE(facts.claimed, facts.human)) : null

/**
 * The line to add to what a Stop hands over, or null. Even with `stop_hook_active`: the stop after a
 * delivery has it set, so it wouldn't be nudged.
 */
export const waitHint = (input: HookInput, facts: StopFacts): string | null => needsWaiter(input, facts) ? WAIT_HINT(facts.human) : null

/** What the hook prints when comments arrived: context the agent acts on (on Stop, it keeps the agent going). */
export const hookResponse = (event: DeliveryEvent, delivery: string) => ({
  hookSpecificOutput: { hookEventName: event === "stop" ? "Stop" as const : "PostToolUse" as const, additionalContext: delivery },
})
