// Claude Code sessions and their subagents for the e2e tests, through the real `cello` CLI and its Claude
// Code hooks, the way Claude Code runs them: each session works from `cwd` (a folder named like its repo),
// and a subagent is launched with SubagentStart and the Agent tool's PostToolUse, checks in with its own
// tool calls, and ends with SubagentStop.
import { spawnSync } from "node:child_process"
import * as path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const SERVER_PORT = Number(process.env.CELLO_E2E_SERVER_PORT ?? 4791)

/**
 * The real `cello` CLI from source against the e2e server, run in `cwd`, as Claude Code session `session`
 * (null: none, as Claude Code runs a hook; the Playwright worker's pid stands in for Claude Code's, so the
 * session stays alive), with `agent` as CELLO_AGENT and `stdin` piped in (a hook's JSON).
 */
export const celloIn = (cwd: string) => (session: string | null, options: { readonly agent?: string; readonly stdin?: string } = {}) =>
  (...args: string[]) => {
    const result = spawnSync("bun", [path.join(root, "apps/cli/src/bin.ts"), ...args], {
      cwd,
      encoding: "utf8",
      input: options.stdin ?? "",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CELLO_PORT: String(SERVER_PORT),
        CLAUDE_PID: String(process.pid),
        ...(session ? { CLAUDE_CODE_SESSION_ID: session } : {}),
        ...(options.agent ? { CELLO_AGENT: options.agent } : {}),
      },
    })
    if (result.status !== 0) throw new Error(`cello ${args.join(" ")} failed: ${result.stderr}`)
    return result.stdout.trim()
  }

/** Claude Code's hooks firing for sessions working in `cwd`. */
export const claudeHooks = (cwd: string) => {
  const cli = celloIn(cwd)
  /** `cello hook claude <event>` with the hook's JSON on stdin. */
  const hook = (event: string, input: Record<string, unknown>) => cli(null, { stdin: JSON.stringify({ cwd, ...input }) })("hook", "claude", event)
  return {
    hook,
    /** `session` launches a subagent with the Agent tool: SubagentStart, the launch (naming its task), its first tool call. */
    launch: (session: string, id: string, type: string, description: string) => {
      hook("subagent-start", { session_id: session, agent_id: id, agent_type: type, hook_event_name: "SubagentStart" })
      hook("post-tool-use", {
        session_id: session, hook_event_name: "PostToolUse", tool_name: "Agent",
        tool_input: { subagent_type: type, description, prompt: `${description}. Read AGENTS.md first.` },
        tool_response: { agentId: id, status: "async_launched" },
      })
      hook("post-tool-use", { session_id: session, agent_id: id, agent_type: type, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: {} })
    },
    /** A subagent's tool call: it checks in. */
    toolCall: (session: string, id: string, type: string, tool = "Bash") =>
      hook("post-tool-use", { session_id: session, agent_id: id, agent_type: type, hook_event_name: "PostToolUse", tool_name: tool, tool_input: {} }),
    /** The subagent finishes. */
    stop: (session: string, id: string, type: string) =>
      hook("subagent-stop", { session_id: session, agent_id: id, agent_type: type, hook_event_name: "SubagentStop" }),
  }
}
