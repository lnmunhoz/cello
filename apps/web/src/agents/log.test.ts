import type { SessionRun, TaskWake } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import type { AgentRow } from "./layout.ts"
import { atBottom, currentStepOf, durationWords, previewOf, runsOf, unavailableWords } from "./log.ts"

describe("durationWords", () => {
  it.each([
    [null, ""],
    [40, "40 ms"],
    [2500, "2.5 s"],
    [12_400, "12 s"],
    [95_000, "1 min 35 s"],
    [3_600_000, "60 min"],
  ])("%j → %j", (ms, words) => expect(durationWords(ms)).toBe(words))
})

describe("previewOf", () => {
  it("the first lines of a result, and how many more there are", () => {
    const output = Array.from({ length: 250 }, (_, i) => `l${i}`).join("\n")
    expect(previewOf(output, 200)).toEqual({ text: output.split("\n").slice(0, 200).join("\n"), more: 50 })
    expect(previewOf("a\nb", 200)).toEqual({ text: "a\nb", more: 0 })
  })
})

describe("unavailableWords", () => {
  it("says why there's no log, in the agent's situation, never naming anyone", () => {
    expect(unavailableWords("missing", true)).toBe("This log isn't on disk yet. It shows up here as soon as Claude Code writes it.")
    expect(unavailableWords("missing", false)).toBe("This log is no longer on disk.")
    expect(unavailableWords("none", true)).toContain("cello install claude")
    expect(unavailableWords("refused", false)).toContain("outside Claude Code's projects folder")
    expect(unavailableWords("unreadable", true)).toBe("Cello couldn't read this log file.")
  })
})

describe("currentStepOf", () => {
  const session = { currentStep: "Agent · cello-builder: PAN-1" } as AgentRow["session"]
  const agent = { currentStep: "Bash · bun run test" } as NonNullable<AgentRow["agent"]>
  it("the agent's or the session's last step, only while it's working", () => {
    expect(currentStepOf({ presence: "active", session, agent })).toBe("Bash · bun run test")
    expect(currentStepOf({ presence: "active", session, agent: null })).toBe("Agent · cello-builder: PAN-1")
    expect(currentStepOf({ presence: "idle", session, agent })).toBeNull()
    expect(currentStepOf({ presence: "ended", session, agent })).toBeNull()
  })
})

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
