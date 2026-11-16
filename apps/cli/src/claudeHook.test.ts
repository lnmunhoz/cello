// The Claude Code hook's side of the wire (https://code.claude.com/docs/en/hooks): what it reads on
// stdin and what it prints for Stop and PostToolUse, and the PreToolUse guard that turns Claude
// artifact publishes away (CEL-57), edits from a session that hasn't claimed a task (CEL-61), and
// AskUserQuestion where nobody watches the window, since questions go on the card (CEL-124).
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  ARTIFACT_DENY_REASON,
  artifactGuard,
  ASK_USER_DENY_REASON,
  askUserAnswer,
  askUserCheck,
  CLAIM_CACHE_MS,
  claimAnswer,
  claimCache,
  claimCheck,
  claimDenyReason,
  hookAction,
  hookIdentity,
  hookResponse,
  hookSession,
  insideAny,
  parseHookInput,
  stopNudge,
  WAIT_HINT,
  WAIT_NUDGE,
  waiterState,
  waitHint,
  waitsInBackground,
  subagentContext,
  subagentTranscript,
  transcriptOf,
} from "./claudeHook.ts"

describe("parseHookInput", () => {
  it("reads the session, folder and loop guard from Claude Code's JSON", () => {
    expect(parseHookInput(JSON.stringify({
      session_id: "2fd0505c-417a",
      transcript_path: "/tmp/t.jsonl",
      cwd: "/Users/me/projects/cello",
      hook_event_name: "Stop",
      stop_hook_active: true,
      last_assistant_message: "Done.",
    }))).toEqual({
      sessionId: "2fd0505c-417a",
      cwd: "/Users/me/projects/cello",
      stopHookActive: true,
      inSubagent: false,
      agent: null,
      launched: null,
      toolName: null,
      toolInput: null,
      backgroundCommands: null,
      permissionMode: null,
      transcriptPath: "/tmp/t.jsonl",
      agentTranscriptPath: null,
    })
  })

  it("reads the session's permission mode (CEL-92): a woken run continues in the same one", () => {
    expect(parseHookInput(JSON.stringify({ session_id: "s", permission_mode: "auto" })).permissionMode).toBe("auto")
    expect(parseHookInput(JSON.stringify({ session_id: "s", permission_mode: "" })).permissionMode).toBeNull()
  })

  it("knows a tool call inside a subagent by its agent_id, and which agent it is (CEL-55)", () => {
    const input = parseHookInput(JSON.stringify({ session_id: "s", hook_event_name: "PostToolUse", agent_id: "a1", agent_type: "Explore" }))
    expect(input.inSubagent).toBe(true)
    expect(input.agent).toEqual({ id: "a1", type: "Explore" })
    expect(parseHookInput(JSON.stringify({ session_id: "s", agent_id: "a1" })).agent).toEqual({ id: "a1", type: null })
  })

  it("reads a subagent launch from the parent's Agent tool: its id from the response, its type, description and prompt (CEL-55)", () => {
    const launch = (tool_name: string, tool_input: unknown, tool_response: unknown) =>
      parseHookInput(JSON.stringify({ session_id: "s", hook_event_name: "PostToolUse", tool_name, tool_input, tool_response })).launched
    const input = { description: "CEL-55 which agent is on each card", prompt: "You are a cello-builder building CEL-55", subagent_type: "cello-builder" }
    expect(launch("Agent", input, { status: "async_launched", agentId: "add98dece6d9c7ec3", outputFile: "/tmp/x" })).toEqual({
      agentId: "add98dece6d9c7ec3",
      agentType: "cello-builder",
      description: "CEL-55 which agent is on each card",
      prompt: "You are a cello-builder building CEL-55",
    })
    // No subagent_type is Claude Code's general-purpose agent; the tool's older name is Task.
    expect(launch("Task", { description: "Look around" }, { status: "completed", agentId: "a2" })).toMatchObject({ agentType: "general-purpose", prompt: null })
    expect(launch("Agent", input, { status: "error" })).toBeNull()
    expect(launch("Bash", { command: "ls" }, { agentId: "a3" })).toBeNull()
  })

  it("treats empty or broken input as no information, never as an error", () => {
    const none = {
      sessionId: null, cwd: null, stopHookActive: false, inSubagent: false, agent: null, launched: null, toolName: null, toolInput: null,
      backgroundCommands: null, permissionMode: null, transcriptPath: null, agentTranscriptPath: null,
    }
    expect(parseHookInput("")).toEqual(none)
    expect(parseHookInput("{not json")).toEqual(none)
    expect(parseHookInput("[1,2]")).toEqual(none)
    expect(parseHookInput(JSON.stringify({ session_id: 42, cwd: "" }))).toEqual(none)
  })
})

describe("Stop's background_tasks (CEL-74)", () => {
  const stop = (backgroundTasks: unknown) =>
    parseHookInput(JSON.stringify({ session_id: "s", hook_event_name: "Stop", stop_hook_active: false, background_tasks: backgroundTasks }))

  it("reads the commands of the shells running in the background; null when Claude Code didn't send the list", () => {
    expect(stop([
      { id: "t1", type: "shell", status: "running", description: "wait", command: "cello inbox --wait" },
      { id: "t2", type: "subagent", status: "running", description: "builder", agent_type: "cello-builder" },
      { id: "t3", type: "shell", status: "running", command: 42 },
    ]).backgroundCommands).toEqual(["cello inbox --wait"])
    expect(stop([]).backgroundCommands).toEqual([])
    expect(stop("nope").backgroundCommands).toBeNull()
    expect(stop(undefined).backgroundCommands).toBeNull()
  })

  it("knows a `cello inbox --wait` among them by its words: cello, then inbox, then --wait", () => {
    const waits = (command: string) => waitsInBackground(stop([{ type: "shell", command }]))
    expect(waits("cello inbox --wait")).toBe(true)
    expect(waits("cello inbox --json --wait")).toBe(true)
    expect(waits("cd /repo && cello inbox --wait")).toBe(true)
    expect(waits("CELLO_PORT=4748 /usr/local/bin/cello inbox --wait 2>&1")).toBe(true)
    expect(waits("cello inbox --new")).toBe(false)
    expect(waits("cello task ask CEL-1 --file ask.yaml --wait")).toBe(false)
    expect(waits("echo cello inbox --wait")).toBe(false)
    expect(waits("cello --wait inbox")).toBe(false)
    expect(waits("tail -f log")).toBe(false)
    expect(waitsInBackground(stop([]))).toBe(false)
    expect(waitsInBackground(stop(undefined))).toBe(false)
  })
})

describe("waiterState (CEL-74): is anything waiting for this session?", () => {
  const stop = (extra: Record<string, unknown> = {}) =>
    parseHookInput(JSON.stringify({ session_id: "s", hook_event_name: "Stop", stop_hook_active: false, ...extra }))
  const shell = (command: string) => ({ background_tasks: [{ type: "shell", status: "running", command }] })

  it("without Claude Code's list, the lock decides", () => {
    expect(waiterState(stop(), "running")).toBe("running")
    expect(waiterState(stop(), "absent")).toBe("absent")
    expect(waiterState(stop(), "unknown")).toBe("unknown")
  })

  it("a background shell running it counts, whatever the lock says", () => {
    expect(waiterState(stop(shell("cello inbox --wait")), "absent")).toBe("running")
  })

  it("an orphan: Claude Code lists its background shells and none waits, so a live lock (a waiter that outlived its session, a reused pid) doesn't count", () => {
    expect(waiterState(stop(shell("bun run dev")), "running")).toBe("absent")
    expect(waiterState(stop({ background_tasks: [] }), "running")).toBe("absent")
    // A lock it can't read still fails open.
    expect(waiterState(stop({ background_tasks: [] }), "unknown")).toBe("unknown")
  })
})

describe("stopNudge (CEL-74): an idle session must still hear its human", () => {
  const stop = (extra: Record<string, unknown> = {}) =>
    parseHookInput(JSON.stringify({ session_id: "s", hook_event_name: "Stop", stop_hook_active: false, ...extra }))
  const claimed = ["CEL-74"]
  const facts = (more: Partial<{ claimed: ReadonlyArray<string>; waiter: "running" | "absent" | "unknown"; woken: boolean }> = {}) =>
    ({ claimed, waiter: "absent" as const, human: "Lucas", ...more })

  it("a run Cello woke (CELLO_WOKEN=1, CEL-92) is never asked for a waiter: it answers and exits", () => {
    expect(stopNudge(stop(), facts({ woken: true }))).toBeNull()
  })

  it("holding a claim with no waiter running, the stop is blocked once with what to start, naming the human", () => {
    expect(stopNudge(stop(), facts())).toEqual({
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: WAIT_NUDGE(claimed, "Lucas") },
    })
    expect(WAIT_NUDGE(claimed, "Ana")).toContain("nothing is waiting for Ana's comments")
    expect(WAIT_NUDGE(claimed, "Ana")).toContain("`cello inbox --wait`")
    expect(WAIT_NUDGE(claimed, "Ana")).toContain("run_in_background")
    expect(WAIT_NUDGE(claimed, "Ana")).toContain("CEL-74")
    expect(WAIT_NUDGE(["CEL-1", "CEL-2"], "Ana")).toContain("CEL-1 and CEL-2")
  })

  it("never twice in a row: when Claude is already continuing because of a Stop hook, the stop goes through", () => {
    expect(stopNudge(stop({ stop_hook_active: true }), facts())).toBeNull()
  })

  it("a waiter already running (its lock, or a background shell running it) lets the stop through", () => {
    expect(stopNudge(stop(), facts({ waiter: "running" }))).toBeNull()
    expect(stopNudge(stop({ background_tasks: [{ type: "shell", status: "running", command: "cello inbox --wait" }] }), facts())).toBeNull()
  })

  it("an orphaned waiter's lock doesn't silence it when Claude Code's list shows no waiter", () => {
    expect(stopNudge(stop({ background_tasks: [] }), facts({ waiter: "running" }))).not.toBeNull()
  })

  it("no claim, nothing to wait for: the stop goes through", () => {
    expect(stopNudge(stop(), facts({ claimed: [] }))).toBeNull()
  })

  it("fails open: a lock it can't read, or a subagent, lets the stop through", () => {
    expect(stopNudge(stop(), facts({ waiter: "unknown" }))).toBeNull()
    expect(stopNudge(stop({ agent_id: "a1" }), facts())).toBeNull()
  })
})

describe("waitHint (CEL-74): a delivery on Stop also says to start a waiter", () => {
  const stop = (extra: Record<string, unknown> = {}) =>
    parseHookInput(JSON.stringify({ session_id: "s", hook_event_name: "Stop", stop_hook_active: false, ...extra }))
  const facts = { claimed: ["CEL-74"], waiter: "absent" as const, human: "Lucas" }

  it("with a claim and no waiter, even when Claude is already continuing (the next stop would go through un-nudged)", () => {
    expect(waitHint(stop(), facts)).toBe(WAIT_HINT("Lucas"))
    expect(waitHint(stop({ stop_hook_active: true }), facts)).toBe(WAIT_HINT("Lucas"))
    expect(WAIT_HINT("Lucas")).toContain("start `cello inbox --wait` in the background")
  })

  it("nothing to add with a waiter running, without a claim, or inside a subagent", () => {
    expect(waitHint(stop(), { ...facts, waiter: "running" })).toBeNull()
    expect(waitHint(stop(), { ...facts, waiter: "unknown" })).toBeNull()
    expect(waitHint(stop(), { ...facts, claimed: [] })).toBeNull()
    expect(waitHint(stop(), { ...facts, woken: true })).toBeNull()
    expect(waitHint(stop({ agent_id: "a1" }), facts)).toBeNull()
  })
})

describe("transcriptOf (CEL-106): which transcript is the caller's", () => {
  const session = "/h/.claude/projects/-repo/2fd0505c.jsonl"
  const of = (input: Record<string, unknown>) => transcriptOf(parseHookInput(JSON.stringify({ session_id: "2fd0505c", ...input })))

  it("the main conversation's is transcript_path", () => {
    expect(of({ transcript_path: session })).toBe(session)
    expect(of({})).toBeNull()
  })

  it("a subagent's is agent_transcript_path (SubagentStop), else its file under the session's subagents/ folder", () => {
    expect(of({ transcript_path: session, agent_id: "a13b", agent_transcript_path: "/h/.claude/projects/-repo/2fd0505c/subagents/agent-a13b.jsonl" }))
      .toBe("/h/.claude/projects/-repo/2fd0505c/subagents/agent-a13b.jsonl")
    expect(of({ transcript_path: session, agent_id: "a13b" })).toBe("/h/.claude/projects/-repo/2fd0505c/subagents/agent-a13b.jsonl")
    // Already its own file: kept.
    expect(of({ transcript_path: "/h/.claude/projects/-repo/2fd0505c/subagents/agent-a13b.jsonl", agent_id: "a13b" }))
      .toBe("/h/.claude/projects/-repo/2fd0505c/subagents/agent-a13b.jsonl")
    expect(of({ agent_id: "a13b" })).toBeNull()
  })

  it("an agent id that would climb out of the folder makes no path", () => {
    expect(subagentTranscript(session, "../../x")).toBeNull()
    expect(subagentTranscript(session, "a/b")).toBeNull()
    expect(subagentTranscript("/h/not-a-transcript.txt", "a13b")).toBeNull()
  })
})

describe("hookSession", () => {
  it("takes the session from stdin, falling back to CLAUDE_CODE_SESSION_ID", () => {
    const input = parseHookInput(JSON.stringify({ session_id: "from-stdin" }))
    expect(hookSession(input, { CLAUDE_CODE_SESSION_ID: "from-env" })).toBe("from-stdin")
    expect(hookSession(parseHookInput(""), { CLAUDE_CODE_SESSION_ID: "from-env" })).toBe("from-env")
    expect(hookSession(parseHookInput(""), {})).toBeNull()
  })
})

describe("hookAction", () => {
  it("delivers comments in the main conversation; inside a subagent it only checks the session in, so the board sees it working", () => {
    expect(hookAction(parseHookInput(JSON.stringify({ session_id: "s" })), {})).toBe("deliver")
    expect(hookAction(parseHookInput(JSON.stringify({ session_id: "s", agent_id: "a1" })), {})).toBe("check-in")
    expect(hookAction(parseHookInput(""), {})).toBe("nothing")
  })
})

// CEL-55: a hook inside a subagent calls as that agent, and hands it the CELLO_AGENT its cello commands need.
describe("hookIdentity and subagentContext", () => {
  it("inside a subagent the hook's calls carry the agent; in the main conversation they don't, whatever the environment says", () => {
    const sub = parseHookInput(JSON.stringify({ session_id: "2fd0505c", agent_id: "a13bfb89", agent_type: "cello-builder" }))
    expect(hookIdentity(sub, { CELLO_AGENT: "stale/x", CELLO_SESSION: "me" })).toEqual({
      CLAUDE_CODE_SESSION_ID: "2fd0505c",
      CELLO_AGENT: "cello-builder/a13bfb89",
    })
    const main = parseHookInput(JSON.stringify({ session_id: "2fd0505c" }))
    expect(hookIdentity(main, { CELLO_AGENT: "stale/x", CLAUDE_PID: "1" })).toEqual({ CLAUDE_PID: "1", CLAUDE_CODE_SESSION_ID: "2fd0505c" })
  })

  it("passes the session's permission mode on (CEL-92), and never a stale one from the environment", () => {
    const withMode = parseHookInput(JSON.stringify({ session_id: "2fd0505c", permission_mode: "acceptEdits" }))
    expect(hookIdentity(withMode, {})).toEqual({ CLAUDE_CODE_SESSION_ID: "2fd0505c", CELLO_PERMISSION_MODE: "acceptEdits" })
    expect(hookIdentity(parseHookInput(JSON.stringify({ session_id: "2fd0505c" })), { CELLO_PERMISSION_MODE: "auto" }))
      .toEqual({ CLAUDE_CODE_SESSION_ID: "2fd0505c" })
  })

  it("passes on the caller's transcript and, after a tool call, its step in one line (CEL-106); never stale ones from the environment", () => {
    const post = parseHookInput(JSON.stringify({
      session_id: "2fd0505c", transcript_path: "/h/.claude/projects/-repo/2fd0505c.jsonl", tool_name: "Bash", tool_input: { command: "bun run test" },
    }))
    expect(hookIdentity(post, { CELLO_TRANSCRIPT: "/stale.jsonl", CELLO_STEP: "stale" })).toEqual({
      CLAUDE_CODE_SESSION_ID: "2fd0505c",
      CELLO_TRANSCRIPT: "/h/.claude/projects/-repo/2fd0505c.jsonl",
      CELLO_STEP: "Bash · bun run test",
    })
    // Inside a subagent: the subagent's own file, next to the session's.
    const sub = parseHookInput(JSON.stringify({
      session_id: "2fd0505c", agent_id: "a13b", agent_type: "cello-builder", transcript_path: "/h/.claude/projects/-repo/2fd0505c.jsonl",
      tool_name: "Edit", tool_input: { file_path: "/repo/src/FacetPanel.tsx" },
    }))
    expect(hookIdentity(sub, {})).toMatchObject({
      CELLO_TRANSCRIPT: "/h/.claude/projects/-repo/2fd0505c/subagents/agent-a13b.jsonl",
      CELLO_STEP: "Edit · FacetPanel.tsx",
    })
    // A Stop says no step; no transcript_path, no transcript.
    expect(hookIdentity(parseHookInput(JSON.stringify({ session_id: "2fd0505c", hook_event_name: "Stop" })), { CELLO_STEP: "stale" }))
      .toEqual({ CLAUDE_CODE_SESSION_ID: "2fd0505c" })
  })

  it("SubagentStart: tells the subagent its --agent, as context, and that claims stay with the main conversation", () => {
    const out = subagentContext({ id: "a13bfb89", type: "cello-builder" })
    expect(out.hookSpecificOutput.hookEventName).toBe("SubagentStart")
    expect(out.hookSpecificOutput.additionalContext).toContain("`cello --agent cello-builder/a13bfb89 task comment CEL-1")
    expect(out.hookSpecificOutput.additionalContext).toContain("cello inbox")
    expect(subagentContext({ id: "a2", type: null }).hookSpecificOutput.additionalContext).toContain("cello --agent a2 ")
  })

  it("SubagentStart never tells a subagent to put a variable before `cello` (CEL-90): Bash(cello:*) only allows commands that start with cello", () => {
    const context = subagentContext({ id: "a13bfb89", type: "cello-builder" }).hookSpecificOutput.additionalContext
    expect(context).not.toContain("CELLO_AGENT=")
    expect(context).toContain("Keep your commands starting with `cello` (no variables in front)")
  })
})

describe("hookResponse", () => {
  it("Stop: hands the comments back as hook feedback, which keeps the agent going without showing a hook error", () => {
    expect(hookResponse("stop", "New comment")).toEqual({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: "New comment" } })
  })

  it("PostToolUse: adds the comments as context next to the tool result", () => {
    expect(hookResponse("post-tool-use", "New comment")).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "New comment" },
    })
  })
})

describe("artifactGuard (CEL-57)", () => {
  const artifact = (toolInput: unknown, extra: Record<string, unknown> = {}) =>
    parseHookInput(JSON.stringify({ session_id: "s", hook_event_name: "PreToolUse", tool_name: "Artifact", tool_input: toolInput, ...extra }))
  const deny = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ARTIFACT_DENY_REASON } }

  it("reads the tool's name and input", () => {
    expect(artifact({ action: "read", url: "u" })).toMatchObject({ toolName: "Artifact", toolInput: { action: "read", url: "u" } })
  })

  it("denies a publish (action left out, or \"publish\"; files, assets or a type), saying to publish a Cello page instead", () => {
    for (const toolInput of [
      { file_path: "/tmp/report.html", icon: "document" },
      { action: "publish", file_path: "/tmp/report.html" },
      { action: "publish", url: "https://claude.ai/artifact/abc", file_paths: ["/tmp/a.png"], asset: true },
      { url: "https://claude.ai/artifact/abc", from_url: "https://claude.ai/artifact/def", asset_ids: ["0".repeat(32)], asset: true },
      { type_url: "https://claude.ai/artifact/type", title: "Board", auto_open: "after_first_write" },
      { action: null, file_path: "/tmp/report.html" },
    ]) {
      expect(artifactGuard(artifact(toolInput), {})).toEqual(deny)
    }
    expect(ARTIFACT_DENY_REASON).toContain("This project uses Cello.")
    expect(ARTIFACT_DENY_REASON).toContain("`cello doc publish page.md --task KEY-n`")
    // CEL-88: opened with `cello open`, and linked in the reply with the cello:// link, which opens Cello, not Claude's browser.
    expect(ARTIFACT_DENY_REASON).toContain("`cello open <slug>`")
    expect(ARTIFACT_DENY_REASON).toContain("link the page with the cello:// link those commands print, never its http address")
    // docs/cli.md quotes it word for word, so agents know what they'll read.
    expect(fs.readFileSync(path.resolve(import.meta.dirname, "../../../docs/cli.md"), "utf8")).toContain(`\n${ARTIFACT_DENY_REASON}\n`)
  })

  it("denies inside a subagent too: it would publish to the same place", () => {
    expect(artifactGuard(artifact({ file_path: "/tmp/r.html" }, { agent_id: "a1" }), {})).toEqual(deny)
  })

  it("lets every other action through, silently", () => {
    for (const action of ["read", "list", "open", "delete", "pin", "unpin", "quickstart"]) {
      expect(artifactGuard(artifact({ action, url: "https://claude.ai/artifact/abc" }), {})).toBeNull()
    }
  })

  it("CELLO_ALLOW_ARTIFACTS=1 (Lucas asked for an artifact by name) lets a publish through", () => {
    expect(artifactGuard(artifact({ file_path: "/tmp/r.html" }), { CELLO_ALLOW_ARTIFACTS: "1" })).toBeNull()
    expect(artifactGuard(artifact({ file_path: "/tmp/r.html" }), { CELLO_ALLOW_ARTIFACTS: "0" })).toEqual(deny)
    expect(artifactGuard(artifact({ file_path: "/tmp/r.html" }), { CELLO_ALLOW_ARTIFACTS: "" })).toEqual(deny)
  })

  it("never fails closed: broken input, another tool, or a tool_input it can't read all mean allow", () => {
    expect(artifactGuard(parseHookInput(""), {})).toBeNull()
    expect(artifactGuard(parseHookInput("{not json"), {})).toBeNull()
    expect(artifactGuard(parseHookInput(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } })), {})).toBeNull()
    expect(artifactGuard(parseHookInput(JSON.stringify({ tool_name: "Write", tool_input: { file_path: "/tmp/r.html" } })), {})).toBeNull()
    expect(artifactGuard(artifact(undefined), {})).toBeNull()
    expect(artifactGuard(artifact("publish"), {})).toBeNull()
    expect(artifactGuard(artifact([1, 2]), {})).toBeNull()
    expect(artifactGuard(artifact({ action: 42 }), {})).toBeNull()
    expect(artifactGuard(artifact({ action: "something-new" }), {})).toBeNull()
  })
})

describe("the AskUserQuestion guard (CEL-124)", () => {
  // Claude's question dialog blocks the session until someone answers it. It's denied only where nobody
  // watches the window: a subagent, a run Cello woke, a session in orchestrate mode. A chat keeps it.
  const ask = (extra: Record<string, unknown> = {}) =>
    parseHookInput(JSON.stringify({
      session_id: "s",
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question: "Merge it?", header: "Merge", multiSelect: false, options: [{ label: "Yes" }, { label: "No" }] }] },
      ...extra,
    }))
  const deny = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ASK_USER_DENY_REASON } }

  it("a session chatting in the terminal: the server is asked whether it's orchestrating; not orchestrating lets the dialog through", () => {
    expect(askUserCheck(ask(), {})).toBe("ask-server")
    expect(askUserAnswer({ orchestrating: false })).toBeNull()
  })

  it("orchestrating: denied; once it's off again, allowed", () => {
    expect(askUserAnswer({ orchestrating: true })).toEqual(deny)
    expect(askUserAnswer({ orchestrating: false })).toBeNull()
  })

  it("a subagent or a run Cello woke (CELLO_WOKEN=1): denied without asking the server", () => {
    expect(askUserCheck(ask({ agent_id: "a1", agent_type: "cello-builder" }), {})).toBe("deny")
    expect(askUserCheck(ask(), { CELLO_WOKEN: "1" })).toBe("deny")
    expect(askUserCheck(ask(), { CELLO_WOKEN: "0" })).toBe("ask-server")
  })

  it("CELLO_ALLOW_ASK_USER=1 lets everything through, a subagent and a woken run too", () => {
    expect(askUserCheck(ask(), { CELLO_ALLOW_ASK_USER: "1" })).toBeNull()
    expect(askUserCheck(ask({ agent_id: "a1" }), { CELLO_ALLOW_ASK_USER: "1" })).toBeNull()
    expect(askUserCheck(ask(), { CELLO_ALLOW_ASK_USER: "1", CELLO_WOKEN: "1" })).toBeNull()
  })

  it("never fails closed: broken input, another tool, or no session to ask about all mean allow", () => {
    expect(askUserCheck(parseHookInput(""), {})).toBeNull()
    expect(askUserCheck(parseHookInput("{not json"), {})).toBeNull()
    expect(askUserCheck(parseHookInput(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } })), {})).toBeNull()
    expect(askUserCheck(parseHookInput(JSON.stringify({ tool_name: "Artifact", tool_input: { file_path: "/tmp/r.html" } })), { CELLO_WOKEN: "1" })).toBeNull()
    expect(askUserCheck(ask({ session_id: undefined }), {})).toBeNull()
    expect(askUserCheck(ask({ session_id: undefined }), { CLAUDE_CODE_SESSION_ID: "s" })).toBe("ask-server")
  })

  it("the reason says to ask on the card, to make a task when none fits, and how a chatting human gets the dialog back", () => {
    expect(ASK_USER_DENY_REASON).toContain("This project uses Cello")
    expect(ASK_USER_DENY_REASON).toContain("`cello task ask KEY-n --file ask.yaml --wait`")
    expect(ASK_USER_DENY_REASON).toContain("run_in_background")
    expect(ASK_USER_DENY_REASON).toContain("Needs input")
    expect(ASK_USER_DENY_REASON).toContain("`cello task create \"<the decision>\" --status Todo`")
    expect(ASK_USER_DENY_REASON).toContain("/cello:orchestrate off")
    expect(ASK_USER_DENY_REASON).toContain("CELLO_ALLOW_ASK_USER=1")
    // docs/cli.md quotes it word for word, so agents know what they'll read.
    expect(fs.readFileSync(path.resolve(import.meta.dirname, "../../../docs/cli.md"), "utf8")).toContain(`\n${ASK_USER_DENY_REASON}\n`)
  })
})

describe("the claim guard (CEL-61)", () => {
  const edit = (toolName: string, toolInput: unknown, extra: Record<string, unknown> = {}) =>
    parseHookInput(JSON.stringify({ session_id: "s1", cwd: "/repo/app", hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput, ...extra }))

  describe("claimCheck: whether a call needs the server's answer", () => {
    it("Edit, Write and NotebookEdit need it: the session, its folder and the file, resolved against the folder", () => {
      expect(claimCheck(edit("Edit", { file_path: "/repo/app/src/a.ts", old_string: "a", new_string: "b" }), {}, "/elsewhere"))
        .toEqual({ session: "s1", cwd: "/repo/app", file: "/repo/app/src/a.ts" })
      expect(claimCheck(edit("Write", { file_path: "src/b.ts", content: "" }), {}, "/elsewhere"))
        .toEqual({ session: "s1", cwd: "/repo/app", file: "/repo/app/src/b.ts" })
      expect(claimCheck(edit("NotebookEdit", { notebook_path: "/repo/app/n.ipynb", new_source: "" }), {}, "/elsewhere"))
        .toEqual({ session: "s1", cwd: "/repo/app", file: "/repo/app/n.ipynb" })
    })

    it("inside a subagent too: it shares the session, and its edits are the session's", () => {
      expect(claimCheck(edit("Edit", { file_path: "/repo/app/a.ts" }, { agent_id: "a1" }), {}, "/x")).not.toBeNull()
    })

    it("falls back to the hook's own folder and CLAUDE_CODE_SESSION_ID when the input lacks them", () => {
      const input = parseHookInput(JSON.stringify({ tool_name: "Write", tool_input: { file_path: "a.ts" } }))
      expect(claimCheck(input, { CLAUDE_CODE_SESSION_ID: "env-session" }, "/repo/app"))
        .toEqual({ session: "env-session", cwd: "/repo/app", file: "/repo/app/a.ts" })
    })

    it("everything else goes through without asking: other tools, no session, no path, broken input, CELLO_ALLOW_UNTRACKED=1", () => {
      expect(claimCheck(edit("Bash", { command: "rm -rf src" }), {}, "/x")).toBeNull()
      expect(claimCheck(edit("Read", { file_path: "/repo/app/a.ts" }), {}, "/x")).toBeNull()
      expect(claimCheck(edit("Artifact", { file_path: "/repo/app/a.html" }), {}, "/x")).toBeNull()
      expect(claimCheck(parseHookInput(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/a" } })), {}, "/x")).toBeNull()
      expect(claimCheck(edit("Edit", {}), {}, "/x")).toBeNull()
      expect(claimCheck(edit("Edit", { file_path: 42 }), {}, "/x")).toBeNull()
      expect(claimCheck(edit("Edit", "nope"), {}, "/x")).toBeNull()
      expect(claimCheck(parseHookInput("{not json"), { CLAUDE_CODE_SESSION_ID: "s" }, "/x")).toBeNull()
      expect(claimCheck(edit("Edit", { file_path: "/repo/app/a.ts" }), { CELLO_ALLOW_UNTRACKED: "1" }, "/x")).toBeNull()
      expect(claimCheck(edit("Edit", { file_path: "/repo/app/a.ts" }), { CELLO_ALLOW_UNTRACKED: "0" }, "/x")).not.toBeNull()
    })
  })

  describe("insideAny: only files inside the repo are guarded", () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-inside-")))
    afterAll(() => fs.rmSync(base, { recursive: true, force: true }))
    const repo = path.join(base, "app")
    fs.mkdirSync(path.join(repo, "src"), { recursive: true })

    it("a file in the repo or below it, existing or new, in a new folder too", () => {
      expect(insideAny(path.join(repo, "src", "a.ts"), [repo])).toBe(true)
      expect(insideAny(path.join(repo, "new", "deep", "b.ts"), [repo])).toBe(true)
      expect(insideAny(repo, [repo])).toBe(true)
      // A folder whose name starts with two dots is still inside.
      expect(insideAny(path.join(repo, "..foo", "a.ts"), [repo])).toBe(true)
      expect(insideAny(path.join(repo, "..", "app", "src", "a.ts"), [repo])).toBe(true)
      expect(insideAny(path.join(repo, ".."), [repo])).toBe(false)
    })

    it("not a scratchpad or temp file outside it, nor a sibling whose name starts the same", () => {
      expect(insideAny(path.join(base, "scratchpad", "notes.md"), [repo])).toBe(false)
      expect(insideAny(path.join(base, "app-other", "a.ts"), [repo])).toBe(false)
      expect(insideAny("/tmp/x.md", [repo])).toBe(false)
    })

    it("follows symlinks, so a path spelled through one (macOS /tmp) still counts", () => {
      const link = path.join(base, "link")
      fs.symlinkSync(repo, link)
      expect(insideAny(path.join(link, "src", "c.ts"), [repo])).toBe(true)
      expect(insideAny(path.join(repo, "src", "c.ts"), [link])).toBe(true)
    })

    it("any of the roots (the checkout and the main checkout); null roots are skipped", () => {
      expect(insideAny(path.join(repo, "a.ts"), [null, path.join(base, "other"), repo])).toBe(true)
      expect(insideAny(path.join(repo, "a.ts"), [null])).toBe(false)
    })
  })

  describe("claimAnswer: the server's answer to the hook's output", () => {
    const deny = (key: string) => ({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: claimDenyReason(key) },
    })

    it("a claimed task in the project lets the edit through; none denies it, naming the project", () => {
      expect(claimAnswer({ projectKey: "THAI", claimed: 1 })).toBeNull()
      expect(claimAnswer({ projectKey: "THAI", claimed: 0 })).toEqual(deny("THAI"))
    })

    it("the reason says what to do, with the project's key", () => {
      expect(claimDenyReason("THAI")).toBe(
        "Cello: this session hasn't claimed a task in THAI. Before editing for a request, check it exists (`cello task list`), else " +
          "`cello task create \"<title>\"` with the human's words, then `cello task claim THAI-n`.",
      )
      // docs/cli.md quotes it word for word, so agents know what they'll read.
      expect(fs.readFileSync(path.resolve(import.meta.dirname, "../../../docs/cli.md"), "utf8")).toContain(`\n${claimDenyReason("KEY")}\n`)
    })
  })

  describe("claimCache: a claim seen recently isn't asked about again", () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-claim-cache-")))
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
    const key = { port: "4747", repoPath: "/repo/app", session: "s1" }

    it("remembers a claim for CLAIM_CACHE_MS, per session, repo and server", () => {
      const cache = claimCache(dir, key)
      expect(cache.fresh(1_000)).toBe(false)
      cache.remember(1_000)
      expect(cache.fresh(1_000 + CLAIM_CACHE_MS - 1)).toBe(true)
      expect(cache.fresh(1_000 + CLAIM_CACHE_MS)).toBe(false)
      expect(claimCache(dir, { ...key, session: "s2" }).fresh(1_000)).toBe(false)
      expect(claimCache(dir, { ...key, repoPath: "/repo/other" }).fresh(1_000)).toBe(false)
      expect(claimCache(dir, { ...key, port: "4748" }).fresh(1_000)).toBe(false)
    })

    it("a claim stamped in the future (a clock set back) isn't trusted", () => {
      const cache = claimCache(dir, { ...key, session: "future" })
      cache.remember(10_000)
      expect(cache.fresh(9_999)).toBe(false)
      expect(cache.fresh(10_000)).toBe(true)
    })

    it("the cache file is readable by its owner only", () => {
      const cache = claimCache(dir, { ...key, session: "private" })
      cache.remember(1)
      expect(fs.statSync(cache.file).mode & 0o777).toBe(0o600)
    })

    it("never throws: a folder it can't write or a broken entry just means no cache", () => {
      const file = path.join(dir, "a-file")
      fs.writeFileSync(file, "")
      const blocked = claimCache(path.join(file, "below"), key)
      expect(() => blocked.remember(1)).not.toThrow()
      expect(blocked.fresh(1)).toBe(false)

      const broken = claimCache(dir, { ...key, session: "broken" })
      broken.remember(5)
      fs.writeFileSync(broken.file, "garbage")
      expect(broken.fresh(5)).toBe(false)
    })
  })
})
