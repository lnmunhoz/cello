// The Claude Code hook's side of the wire (https://code.claude.com/docs/en/hooks): what it reads on
// stdin and what it prints for Stop and PostToolUse, and the PreToolUse guard that turns Claude
// artifact publishes away (CEL-57).
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { ARTIFACT_DENY_REASON, artifactGuard, hookResponse, hookSession, parseHookInput } from "./claudeHook.ts"

describe("parseHookInput", () => {
  it("reads the session, folder and loop guard from Claude Code's JSON", () => {
    expect(parseHookInput(JSON.stringify({
      session_id: "2fd0505c-417a",
      transcript_path: "/tmp/t.jsonl",
      cwd: "/Users/me/projects/cello",
      hook_event_name: "Stop",
      stop_hook_active: true,
      last_assistant_message: "Done.",
    }))).toEqual({ sessionId: "2fd0505c-417a", cwd: "/Users/me/projects/cello", stopHookActive: true, inSubagent: false, toolName: null, toolInput: null })
  })

  it("knows a tool call inside a subagent by its agent_id", () => {
    expect(parseHookInput(JSON.stringify({ session_id: "s", hook_event_name: "PostToolUse", agent_id: "a1", agent_type: "Explore" })).inSubagent)
      .toBe(true)
  })

  it("treats empty or broken input as no information, never as an error", () => {
    const none = { sessionId: null, cwd: null, stopHookActive: false, inSubagent: false, toolName: null, toolInput: null }
    expect(parseHookInput("")).toEqual(none)
    expect(parseHookInput("{not json")).toEqual(none)
    expect(parseHookInput("[1,2]")).toEqual(none)
    expect(parseHookInput(JSON.stringify({ session_id: 42, cwd: "" }))).toEqual(none)
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
