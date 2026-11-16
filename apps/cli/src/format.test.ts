import { describe, expect, it } from "vitest"
import { agentName, sessionName } from "./format.ts"

const session = { id: "01JX", clientName: "Claude Code", externalId: "2fd0505c-417a" }
const builder = { agentId: "a13bfb89c0de1234f", agentType: "cello-builder" }

describe("sessionName", () => {
  it("names the session by its client and short id", () => {
    expect(sessionName(session)).toBe("Claude Code session 2fd0505c")
  })

  it("adds the model and effort that wrote something, when known (CEL-119)", () => {
    expect(sessionName(session, { model: "claude-opus-5-5", effort: "high" })).toBe("Claude Code session 2fd0505c (Opus 5.5, high)")
    expect(sessionName(session, { model: null, effort: "high" })).toBe("Claude Code session 2fd0505c")
  })
})

describe("agentName", () => {
  it("names a subagent by its type and short id, under its session", () => {
    expect(agentName(builder, session)).toBe("cello-builder · a13bfb89 (under Claude Code session 2fd0505c)")
    expect(agentName({ agentId: "a13bfb89c0de1234f", agentType: null })).toBe("agent · a13bfb89")
  })

  it("adds the model and effort that wrote something, before its session, when known (CEL-119)", () => {
    expect(agentName(builder, session, { model: "claude-sonnet-5-5", effort: "medium" }))
      .toBe("cello-builder · a13bfb89 (Sonnet 5.5, medium; under Claude Code session 2fd0505c)")
    expect(agentName(builder, undefined, { model: "claude-sonnet-5-5", effort: "medium" })).toBe("cello-builder · a13bfb89 (Sonnet 5.5, medium)")
    expect(agentName(builder, session, { model: "claude-foo-6" })).toBe("cello-builder · a13bfb89 (claude-foo-6; under Claude Code session 2fd0505c)")
  })
})
