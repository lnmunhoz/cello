// Test 2 (CLI side) and the headers M2 lists: the environment becomes identity headers.
import { describe, expect, it } from "vitest"
import { identityHeaders } from "./identity.ts"

const claude = {
  CLAUDE_CODE_SESSION_ID: "2fd0505c-417a-4167-acfe-2d66080fcae0",
  CLAUDE_PID: "62691",
  CLAUDE_CODE_ENTRYPOINT: "cli",
}

describe("identityHeaders", () => {
  it("a Claude Code shell sends its session, client, pid, entrypoint and folder", () => {
    expect(identityHeaders(claude, "/Users/lnmunhoz/projects/cello")).toEqual({
      "x-cello-session": "2fd0505c-417a-4167-acfe-2d66080fcae0",
      "x-cello-client": "Claude Code",
      "x-cello-pid": "62691",
      "x-cello-entrypoint": "cli",
      "x-cello-cwd": "/Users/lnmunhoz/projects/cello",
    })
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

  it("CELLO_SESSION=me and no agent variables both record the human", () => {
    expect(identityHeaders({ ...claude, CELLO_SESSION: "me" }, "/x")).toEqual({ "x-cello-session": "me", "x-cello-cwd": "/x" })
    expect(identityHeaders({ HOME: "/Users/lnmunhoz" }, "/x")).toEqual({ "x-cello-cwd": "/x" })
  })
})
