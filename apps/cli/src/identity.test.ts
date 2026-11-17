// Test 2 (CLI side) and the headers M2 lists: the environment becomes identity headers.
import { describe, expect, it } from "vitest"
import { IDENTITY_HEADERS } from "@cello/contract/rpcs"
import { identityHeaders } from "./identity.ts"

const claude = {
  CLAUDE_CODE_SESSION_ID: "2fd0505c-417a-4167-acfe-2d66080fcae0",
  CLAUDE_PID: "62691",
  CLAUDE_CODE_ENTRYPOINT: "cli",
}

describe("identityHeaders", () => {
  it("the hook's CELLO_PERMISSION_MODE becomes the permission mode header (CEL-92)", () => {
    expect(identityHeaders({ CLAUDE_CODE_SESSION_ID: "s1", CELLO_PERMISSION_MODE: "auto" }, "/repo")[IDENTITY_HEADERS.permissionMode]).toBe("auto")
    expect(identityHeaders({ CLAUDE_CODE_SESSION_ID: "s1" }, "/repo")[IDENTITY_HEADERS.permissionMode]).toBeUndefined()
  })

  it("the hook's CELLO_TRANSCRIPT and CELLO_STEP become the transcript and step headers (CEL-106); the human sends neither", () => {
    const env = { CLAUDE_CODE_SESSION_ID: "s1", CELLO_TRANSCRIPT: "/h/.claude/projects/-repo/s1.jsonl", CELLO_STEP: "Bash · bun run test" }
    const headers = identityHeaders(env, "/repo")
    expect(headers[IDENTITY_HEADERS.transcript]).toBe("/h/.claude/projects/-repo/s1.jsonl")
    expect(headers[IDENTITY_HEADERS.step]).toBe("Bash · bun run test")
    const human = identityHeaders({ ...env, CELLO_SESSION: "me" }, "/repo")
    expect([human[IDENTITY_HEADERS.transcript], human[IDENTITY_HEADERS.step]]).toEqual([undefined, undefined])
  })

  it("a Claude Code shell sends its session, client, pid, entrypoint and folder", () => {
    expect(identityHeaders(claude, "/Users/lnmunhoz/projects/cello")).toEqual({
      "x-cello-session": "2fd0505c-417a-4167-acfe-2d66080fcae0",
      "x-cello-client": "Claude Code",
      "x-cello-pid": "62691",
      "x-cello-entrypoint": "cli",
      "x-cello-cwd": "/Users/lnmunhoz/projects/cello",
    })
  })

  it("TERM_PROGRAM becomes the terminal header (CEL-137): which terminal app the session runs in", () => {
    expect(identityHeaders({ ...claude, TERM_PROGRAM: "WezTerm" }, "/x")[IDENTITY_HEADERS.terminal]).toBe("WezTerm")
    expect(identityHeaders(claude, "/x")[IDENTITY_HEADERS.terminal]).toBeUndefined()
    expect(identityHeaders({ TERM_PROGRAM: "WezTerm" }, "/x")[IDENTITY_HEADERS.terminal]).toBeUndefined()
  })

  it("a run Cello woke (CELLO_WOKEN=1) leaves out where it runs: the session keeps the terminal or app it was started in (CEL-137)", () => {
    const woken = identityHeaders({ ...claude, CLAUDE_CODE_ENTRYPOINT: "sdk-cli", TERM_PROGRAM: "tmux", CELLO_WOKEN: "1" }, "/x")
    expect([woken[IDENTITY_HEADERS.entrypoint], woken[IDENTITY_HEADERS.terminal]]).toEqual([undefined, undefined])
    expect(woken[IDENTITY_HEADERS.session]).toBe(claude.CLAUDE_CODE_SESSION_ID)
  })

  it("CELLO_SESSION wins over the Claude session id", () => {
    expect(identityHeaders({ ...claude, CELLO_SESSION: "custom" }, "/x")).toMatchObject({
      "x-cello-session": "custom",
      "x-cello-client": "Claude Code",
    })
    expect(identityHeaders({ CELLO_SESSION: "script-1" }, "/x")).toEqual({
      "x-cello-session": "script-1",
      "x-cello-client": "Agent",
      "x-cello-cwd": "/x",
    })
  })

  it("CELLO_AGENT names the session's subagent making the call (CEL-55): <type>/<id>, or just the id", () => {
    expect(identityHeaders({ ...claude, CELLO_AGENT: "cello-builder/a13bfb89" }, "/x")).toMatchObject({
      "x-cello-session": claude.CLAUDE_CODE_SESSION_ID,
      "x-cello-agent": "a13bfb89",
      "x-cello-agent-type": "cello-builder",
    })
    expect(identityHeaders({ ...claude, CELLO_AGENT: "my-plugin:reviewer/b77d0e11" }, "/x")).toMatchObject({
      "x-cello-agent": "b77d0e11",
      "x-cello-agent-type": "my-plugin:reviewer",
    })
    const idOnly = identityHeaders({ ...claude, CELLO_AGENT: " a13bfb89 " }, "/x")
    expect(idOnly["x-cello-agent"]).toBe("a13bfb89")
    expect(idOnly["x-cello-agent-type"]).toBeUndefined()
    // No session, or the human: no agent either.
    expect(identityHeaders({ CELLO_AGENT: "cello-builder/a13bfb89" }, "/x")).toEqual({ "x-cello-cwd": "/x" })
    expect(identityHeaders({ ...claude, CELLO_SESSION: "me", CELLO_AGENT: "a1" }, "/x")).toEqual({ "x-cello-session": "me", "x-cello-cwd": "/x" })
  })

  it("CELLO_SESSION=me and no agent variables both record the human", () => {
    expect(identityHeaders({ ...claude, CELLO_SESSION: "me" }, "/x")).toEqual({ "x-cello-session": "me", "x-cello-cwd": "/x" })
    expect(identityHeaders({ HOME: "/Users/lnmunhoz" }, "/x")).toEqual({ "x-cello-cwd": "/x" })
  })
})
