import { describe, expect, it } from "vitest"
import type { CelloEvent, StreamedEvent } from "@cello/contract/events"
import { agentName, eventCells, lostClaimLine, sessionName } from "./format.ts"

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

// CEL-150: a recent event or a lost claim of a type a newer server added reads as `unreadable`; it
// prints a line saying so instead of failing the command. A known event reads exactly as before.
describe("eventCells and lostClaimLine", () => {
  const now = 1_700_000_100_000
  const lucas = { id: "me", name: "Lucas" }
  const historyNames = { statuses: {}, labels: {}, actors: { me: lucas } } as never
  const names = { statuses: [], sessions: [], actors: [lucas] }
  const envelope = { ts: now, commandId: "c", actorId: "me", sessionId: null, workspaceId: "w1", projectId: "p1", schemaVersion: 1 }
  const created = { ...envelope, seq: 5, type: "task.created" } as unknown as CelloEvent
  const ended = { ...envelope, seq: 6, type: "task.claim_ended" } as unknown as CelloEvent
  const taken = { ...envelope, seq: 7, type: "task.claim_taken" } as unknown as CelloEvent
  const unreadable = (ts?: number): StreamedEvent => ({ type: "unreadable", seq: 8, sentType: "test.from-a-newer-build", ...(ts === undefined ? {} : { ts }) })

  it("reads an event as its time and its text, and an unreadable one as its time (if any) and 'a change this version can't show'", () => {
    expect(eventCells(created, now, names, historyNames)).toEqual(["just now", "Lucas created the task"])
    expect(eventCells(unreadable(now - 120_000), now, names, historyNames)).toEqual(["2m ago", "A change this version of Cello can't show"])
    expect(eventCells(unreadable(), now, names, historyNames)).toEqual(["", "A change this version of Cello can't show"])
  })

  it("says a claim was taken over or ended, by whom, and when", () => {
    expect(lostClaimLine({ event: taken, taskKey: "CEL-1" }, now, names, historyNames)).toBe("  CEL-1  taken over by Lucas, just now")
    expect(lostClaimLine({ event: ended, taskKey: "CEL-1" }, now, names, historyNames)).toBe("  CEL-1  ended when Lucas changed it, just now")
    expect(lostClaimLine({ event: taken, taskKey: null }, now, names, historyNames)).toBe("  ?  taken over by Lucas, just now")
  })

  it("shows a lost claim of a type this version can't read, with its time only when it has one", () => {
    expect(lostClaimLine({ event: unreadable(now - 3_600_000), taskKey: "CEL-2" }, now, names, historyNames))
      .toBe("  CEL-2  A change this version of Cello can't show, 1h ago")
    expect(lostClaimLine({ event: unreadable(), taskKey: "CEL-2" }, now, names, historyNames))
      .toBe("  CEL-2  A change this version of Cello can't show")
  })
})
