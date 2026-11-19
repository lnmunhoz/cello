// The Agents page's Folder (CEL-152): a subagent's own folder, else its session's (agents seen before, an older server).
import type { AgentSession, SessionAgent } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { agentFolder } from "./folder.ts"

const session = { id: "s1", cwd: "/work/main" } as AgentSession
const agent = { sessionId: "s1", agentId: "a1" } as SessionAgent

describe("agentFolder", () => {
  it("a session shows its own folder", () => {
    expect(agentFolder({ session, agent: null })).toBe("/work/main")
    expect(agentFolder({ session: { ...session, cwd: null }, agent: null })).toBeNull()
  })

  it("a subagent shows its own folder, not its session's", () => {
    expect(agentFolder({ session, agent: { ...agent, cwd: "/work/wt-a" } })).toBe("/work/wt-a")
  })

  it("a subagent with none (seen before CEL-152, or from an older server) falls back to its session's", () => {
    expect(agentFolder({ session, agent })).toBe("/work/main")
    expect(agentFolder({ session, agent: { ...agent, cwd: null } })).toBe("/work/main")
    expect(agentFolder({ session: { ...session, cwd: null }, agent })).toBeNull()
  })
})
