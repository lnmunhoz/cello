// CEL-160: a subagent's runs on a task, rebuilt from the agent.seen events every start, stop and resume
// writes. A stop ends a run; a resume (a start, or any call after it) opens the next. The row alone holds
// only the latest, so the events give each run its own start, end and verdict.
import { describe, expect, it } from "vitest"
import { agentRuns, type SeenAgent } from "./agentRuns.ts"

const agent = (over: Partial<SeenAgent> = {}): SeenAgent => ({ startedAt: 1_000, lastSeenAt: 1_000, endedAt: null, verdict: null, ...over })
const seen = (ts: number, over: Partial<SeenAgent> = {}) => ({ ts, agent: agent({ lastSeenAt: ts, ...over }) })

describe("agentRuns", () => {
  it("one run: from its start to its stop, with the verdict it left", () => {
    const events = [seen(1_000), seen(5_000), seen(9_000, { endedAt: 9_000, verdict: "fix_first" })]
    expect(agentRuns(agent({ lastSeenAt: 9_000, endedAt: 9_000, verdict: "fix_first" }), events)).toEqual([
      { startedAt: 1_000, endedAt: 9_000, verdict: "fix_first" },
    ])
  })

  it("finish, resume, finish: two runs, each with its own verdict", () => {
    const events = [
      seen(1_000),
      seen(9_000, { endedAt: 9_000, verdict: "fix_first" }),
      seen(20_000), // resumed: endedAt cleared
      seen(30_000, { endedAt: 30_000, verdict: "merge" }),
    ]
    expect(agentRuns(agent({ lastSeenAt: 30_000, endedAt: 30_000, verdict: "merge" }), events)).toEqual([
      { startedAt: 1_000, endedAt: 9_000, verdict: "fix_first" },
      { startedAt: 20_000, endedAt: 30_000, verdict: "merge" },
    ])
  })

  it("the same event twice (same time) is still one run", () => {
    const stop = seen(9_000, { endedAt: 9_000, verdict: "merge" })
    expect(agentRuns(agent({ lastSeenAt: 9_000, endedAt: 9_000, verdict: "merge" }), [seen(1_000), stop, stop, seen(1_000)])).toEqual([
      { startedAt: 1_000, endedAt: 9_000, verdict: "merge" },
    ])
  })

  it("a stale check-in written after the stop, from before it, doesn't open a run", () => {
    const events = [seen(1_000), seen(9_000, { endedAt: 9_000 }), { ts: 9_001, agent: agent({ lastSeenAt: 8_500 }) }]
    expect(agentRuns(agent({ lastSeenAt: 9_000, endedAt: 9_000 }), events)).toEqual([{ startedAt: 1_000, endedAt: 9_000, verdict: null }])
  })

  it("a stop whose event is missing: the row closes the last run, with its verdict", () => {
    expect(agentRuns(agent({ lastSeenAt: 9_000, endedAt: 9_000, verdict: "ask" }), [seen(1_000), seen(5_000)])).toEqual([
      { startedAt: 1_000, endedAt: 9_000, verdict: "ask" },
    ])
    expect(agentRuns(agent({ lastSeenAt: 9_000, endedAt: 9_000, verdict: "merge" }), [])).toEqual([{ startedAt: 1_000, endedAt: 9_000, verdict: "merge" }])
  })

  it("a resumed row with no resume event opens a run at its last seen time", () => {
    const events = [seen(1_000), seen(9_000, { endedAt: 9_000, verdict: "fix_first" })]
    expect(agentRuns(agent({ lastSeenAt: 20_000 }), events)).toEqual([
      { startedAt: 1_000, endedAt: 9_000, verdict: "fix_first" },
      { startedAt: 20_000, endedAt: null, verdict: null },
    ])
  })

  it("an agent waiting on its background work is still running: no end", () => {
    const events = [seen(1_000), seen(9_000)] // a stop that only waits keeps endedAt null
    expect(agentRuns(agent({ lastSeenAt: 9_000 }), events)).toEqual([{ startedAt: 1_000, endedAt: null, verdict: null }])
  })

  it("a second stop with no resume between moves the end and the verdict, not a new run", () => {
    const events = [seen(1_000), seen(9_000, { endedAt: 9_000 }), seen(12_000, { endedAt: 12_000, verdict: "merge" })]
    expect(agentRuns(agent({ lastSeenAt: 12_000, endedAt: 12_000, verdict: "merge" }), events)).toEqual([
      { startedAt: 1_000, endedAt: 12_000, verdict: "merge" },
    ])
  })

  it("events out of order are read in time order", () => {
    const events = [seen(9_000, { endedAt: 9_000 }), seen(1_000)]
    expect(agentRuns(agent({ lastSeenAt: 9_000, endedAt: 9_000 }), events)).toEqual([{ startedAt: 1_000, endedAt: 9_000, verdict: null }])
  })
})
