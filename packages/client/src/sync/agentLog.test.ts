import type { LogStep } from "@cello/contract/agentLog"
import { describe, expect, it } from "vitest"
import { applyLogUpdate, EMPTY_LOG, filterSteps, logKey, parseLogKey } from "./agentLog.ts"

const message = (id: string, text: string): LogStep => ({ id, kind: "message", at: 1, text })
const tool = (id: string, status: "running" | "ok" | "error"): LogStep => ({
  id,
  kind: "tool",
  at: 2,
  text: "Bash · bun run test",
  tool: { name: "Bash", status, durationMs: status === "running" ? null : 1200, output: "", lines: 0, cut: false },
})

describe("applyLogUpdate", () => {
  it("the first batch replaces what was shown; later ones add steps and replace a step sent again by id, in place", () => {
    let log = applyLogUpdate(EMPTY_LOG, { _tag: "steps", reset: true, skipped: 3, steps: [message("m1", "Starting.")] })
    expect(log).toEqual({ status: "ready", reason: null, skipped: 3, older: false, steps: [message("m1", "Starting.")] })
    log = applyLogUpdate(log, { _tag: "steps", reset: false, skipped: 0, steps: [tool("t1", "running"), message("m2", "Waiting.")] })
    log = applyLogUpdate(log, { _tag: "steps", reset: false, skipped: 0, steps: [tool("t1", "error")] })
    expect(log.steps.map((s) => [s.id, s.tool?.status])).toEqual([["m1", undefined], ["t1", "error"], ["m2", undefined]])
    expect(log.skipped).toBe(3)
    expect(applyLogUpdate(EMPTY_LOG, { _tag: "steps", reset: true, skipped: 0, older: true, steps: [] }).older).toBe(true)
    const again = applyLogUpdate(log, { _tag: "steps", reset: true, skipped: 0, steps: [message("x", "Over.")] })
    expect(again.steps).toEqual([message("x", "Over.")])
  })

  it("unavailable keeps nothing and says why", () => {
    const log = applyLogUpdate(applyLogUpdate(EMPTY_LOG, { _tag: "steps", reset: true, skipped: 0, steps: [message("m1", "a")] }), {
      _tag: "unavailable",
      reason: "missing",
    })
    expect(log).toEqual({ status: "unavailable", reason: "missing", skipped: 0, older: false, steps: [] })
  })
})

describe("filterSteps", () => {
  const steps: LogStep[] = [
    { id: "u", kind: "user", at: 0, text: "Build it" },
    message("m", "On it."),
    { id: "th", kind: "thinking", at: 0, text: "Hmm." },
    tool("ok", "ok"),
    tool("bad", "error"),
    { id: "ag", kind: "agent", at: 0, text: "Agent · x", tool: { ...tool("ag", "error").tool! }, agentId: null },
    { id: "sys", kind: "system", at: 0, text: "The run ended: failed (boom)" },
  ]
  const ids = (filter: Parameters<typeof filterSteps>[1], thinking: boolean) => filterSteps(steps, filter, thinking).map((s) => s.id)

  it("all, messages, tools and errors; thinking only when its switch is on", () => {
    expect(ids("all", false)).toEqual(["u", "m", "ok", "bad", "ag", "sys"])
    expect(ids("all", true)).toEqual(["u", "m", "th", "ok", "bad", "ag", "sys"])
    expect(ids("messages", false)).toEqual(["u", "m"])
    expect(ids("messages", true)).toEqual(["u", "m", "th"])
    expect(ids("tools", false)).toEqual(["ok", "bad", "ag"])
    expect(ids("errors", true)).toEqual(["bad", "ag"])
  })
})

describe("logKey", () => {
  it("round-trips whose log it is", () => {
    for (const source of [{ sessionId: "s1" }, { sessionId: "s1", agentId: "a1" }, { sessionId: "s1", runId: "r1", reveal: true }]) {
      expect(parseLogKey(logKey(source))).toEqual({ agentId: undefined, runId: undefined, reveal: false, ...source })
    }
  })
})
