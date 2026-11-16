import type { SessionRun, TaskWake } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { atBottom, runsOf } from "./log.ts"

describe("runsOf", () => {
  const run = (id: string, sessionId: string, startedAt: number): SessionRun => ({
    id, sessionId, taskId: "t", why: "comment", agentKind: "claude-code", mode: "auto", celloMode: "auto", pid: null,
    startedAt, endedAt: null, exitCode: null, outcome: "completed", error: null,
  })
  const wake = (taskId: string, r: SessionRun | null): TaskWake => ({
    taskId, sessionId: r?.sessionId ?? "s1", state: r ? "ended" : "scheduled", why: "comment", ts: 0, at: null, reason: null, run: r,
  })

  it("the session's runs the board knows, newest first, each once", () => {
    const wakes = { t1: wake("t1", run("r1", "s1", 10)), t2: wake("t2", run("r2", "s1", 20)), t3: wake("t3", run("r1", "s1", 10)), t4: wake("t4", run("r9", "s2", 30)), t5: wake("t5", null) }
    expect(runsOf(wakes, "s1").map((r) => r.id)).toEqual(["r2", "r1"])
    expect(runsOf(wakes, "s3")).toEqual([])
  })
})

describe("atBottom", () => {
  it("within a few pixels of the end counts as the bottom", () => {
    expect(atBottom({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 })).toBe(true)
    expect(atBottom({ scrollTop: 590, clientHeight: 400, scrollHeight: 1000 })).toBe(true)
    expect(atBottom({ scrollTop: 400, clientHeight: 400, scrollHeight: 1000 })).toBe(false)
  })
})
