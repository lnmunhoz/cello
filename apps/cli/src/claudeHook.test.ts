// The Claude Code hook's side of the wire (https://code.claude.com/docs/en/hooks): what it reads on
// stdin and what it prints for Stop and PostToolUse, and the PreToolUse guard that turns Claude
// artifact publishes away (CEL-57) and edits from a session that hasn't claimed a task (CEL-61).
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  ARTIFACT_DENY_REASON,
  artifactGuard,
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
  WAIT_NUDGE,
  waitsInBackground,
  subagentContext,
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
      backgroundCommands: [],
    })
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
    const none = { sessionId: null, cwd: null, stopHookActive: false, inSubagent: false, agent: null, launched: null, toolName: null, toolInput: null, backgroundCommands: [] }
    expect(parseHookInput("")).toEqual(none)
    expect(parseHookInput("{not json")).toEqual(none)
    expect(parseHookInput("[1,2]")).toEqual(none)
    expect(parseHookInput(JSON.stringify({ session_id: 42, cwd: "" }))).toEqual(none)
  })
})

describe("Stop's background_tasks (CEL-74)", () => {
  const stop = (backgroundTasks: unknown) =>
    parseHookInput(JSON.stringify({ session_id: "s", hook_event_name: "Stop", stop_hook_active: false, background_tasks: backgroundTasks }))

  it("reads the commands of the shells running in the background", () => {
    expect(stop([
      { id: "t1", type: "shell", status: "running", description: "wait", command: "cello inbox --wait" },
      { id: "t2", type: "subagent", status: "running", description: "builder", agent_type: "cello-builder" },
      { id: "t3", type: "shell", status: "running", command: 42 },
    ]).backgroundCommands).toEqual(["cello inbox --wait"])
    expect(stop("nope").backgroundCommands).toEqual([])
    expect(stop(undefined).backgroundCommands).toEqual([])
  })

  it("knows a `cello inbox --wait` among them, with or without other flags", () => {
    expect(waitsInBackground(stop([{ type: "shell", command: "cello inbox --wait" }]))).toBe(true)
    expect(waitsInBackground(stop([{ type: "shell", command: "cd /repo && cello inbox --json --wait" }]))).toBe(true)
    expect(waitsInBackground(stop([{ type: "shell", command: "cello inbox --new" }]))).toBe(false)
    expect(waitsInBackground(stop([{ type: "shell", command: "cello task ask CEL-1 --file ask.yaml --wait" }]))).toBe(false)
    expect(waitsInBackground(stop([{ type: "shell", command: "tail -f log" }]))).toBe(false)
    expect(waitsInBackground(stop([]))).toBe(false)
  })
})

describe("stopNudge (CEL-74): an idle session must still hear Lucas", () => {
  const stop = (extra: Record<string, unknown> = {}) =>
    parseHookInput(JSON.stringify({ session_id: "s", hook_event_name: "Stop", stop_hook_active: false, ...extra }))
  const claimed = ["CEL-74"]

  it("holding a claim with no waiter running, the stop is blocked once with what to start", () => {
    expect(stopNudge(stop(), { claimed, waiter: "absent" })).toEqual({
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: WAIT_NUDGE(claimed) },
    })
    expect(WAIT_NUDGE(claimed)).toContain("`cello inbox --wait`")
    expect(WAIT_NUDGE(claimed)).toContain("run_in_background")
    expect(WAIT_NUDGE(claimed)).toContain("CEL-74")
    expect(WAIT_NUDGE(["CEL-1", "CEL-2"])).toContain("CEL-1 and CEL-2")
  })

  it("never twice in a row: when Claude is already continuing because of a Stop hook, the stop goes through", () => {
    expect(stopNudge(stop({ stop_hook_active: true }), { claimed, waiter: "absent" })).toBeNull()
  })

  it("a waiter already running (its lock, or a background shell running it) lets the stop through", () => {
    expect(stopNudge(stop(), { claimed, waiter: "running" })).toBeNull()
    expect(stopNudge(stop({ background_tasks: [{ type: "shell", status: "running", command: "cello inbox --wait" }] }), { claimed, waiter: "absent" }))
      .toBeNull()
  })

  it("no claim, nothing to wait for: the stop goes through", () => {
    expect(stopNudge(stop(), { claimed: [], waiter: "absent" })).toBeNull()
  })

  it("fails open: a lock it can't read, or a subagent, lets the stop through", () => {
    expect(stopNudge(stop(), { claimed, waiter: "unknown" })).toBeNull()
    expect(stopNudge(stop({ agent_id: "a1" }), { claimed, waiter: "absent" })).toBeNull()
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

  it("SubagentStart: tells the subagent its CELLO_AGENT, as context, and that claims stay with the main conversation", () => {
    const out = subagentContext({ id: "a13bfb89", type: "cello-builder" })
    expect(out.hookSpecificOutput.hookEventName).toBe("SubagentStart")
    expect(out.hookSpecificOutput.additionalContext).toContain("CELLO_AGENT=cello-builder/a13bfb89 cello task comment")
    expect(out.hookSpecificOutput.additionalContext).toContain("cello inbox")
    expect(subagentContext({ id: "a2", type: null }).hookSpecificOutput.additionalContext).toContain("CELLO_AGENT=a2 cello")
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
    expect(ARTIFACT_DENY_REASON).toContain("open \"cello://open?url=<url-encoded page link>\"")
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
          "`cello task create \"<title>\"` with Lucas's words, then `cello task claim THAI-n`.",
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
