// The Claude Code hook's side of the wire (https://code.claude.com/docs/en/hooks): what it reads on
// stdin and what it prints for Stop and PostToolUse.
import { describe, expect, it } from "vitest"
import { hookAction, hookResponse, hookSession, parseHookInput } from "./claudeHook.ts"

describe("parseHookInput", () => {
  it("reads the session, folder and loop guard from Claude Code's JSON", () => {
    expect(parseHookInput(JSON.stringify({
      session_id: "2fd0505c-417a",
      transcript_path: "/tmp/t.jsonl",
      cwd: "/Users/me/projects/cello",
      hook_event_name: "Stop",
      stop_hook_active: true,
      last_assistant_message: "Done.",
    }))).toEqual({ sessionId: "2fd0505c-417a", cwd: "/Users/me/projects/cello", stopHookActive: true, inSubagent: false })
  })

  it("knows a tool call inside a subagent by its agent_id", () => {
    expect(parseHookInput(JSON.stringify({ session_id: "s", hook_event_name: "PostToolUse", agent_id: "a1", agent_type: "Explore" })).inSubagent)
      .toBe(true)
  })

  it("treats empty or broken input as no information, never as an error", () => {
    const none = { sessionId: null, cwd: null, stopHookActive: false, inSubagent: false }
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

describe("hookAction", () => {
  it("delivers comments in the main conversation; inside a subagent it only checks the session in, so the board sees it working", () => {
    expect(hookAction(parseHookInput(JSON.stringify({ session_id: "s" })), {})).toBe("deliver")
    expect(hookAction(parseHookInput(JSON.stringify({ session_id: "s", agent_id: "a1" })), {})).toBe("check-in")
    expect(hookAction(parseHookInput(""), {})).toBe("nothing")
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
