// What `cello sessions wake` and `cello sessions runs` print (CEL-92).
import type { SessionRun } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { isTaskKey, runsText, wokeText } from "./sessions.ts"

const run = (more: Partial<SessionRun> = {}): SessionRun => ({
  id: "01RUN",
  sessionId: "s1",
  taskId: "t1",
  why: "comment",
  agentKind: "claude-code",
  mode: "auto",
  celloMode: "auto",
  pid: 777,
  startedAt: new Date(2026, 10, 16, 15, 58).getTime(),
  endedAt: null,
  exitCode: null,
  outcome: "running",
  error: null,
  ...more,
})

describe("isTaskKey", () => {
  it("tells a task key from a session id", () => {
    expect(isTaskKey("CEL-92")).toBe(true)
    expect(isTaskKey("cel-92")).toBe(true)
    expect(isTaskKey("c14ca1fa")).toBe(false)
    expect(isTaskKey("c14ca1fa-6f0e-4c1b-9d55-5b8c6c1e2a10")).toBe(false)
  })
})

describe("wokeText", () => {
  it("says which session woke, in which mode, where its log is and how to stop it", () => {
    expect(wokeText("c14ca1fa-6f0e", run(), "/data/runs/c14ca1fa-6f0e/x.jsonl")).toBe(
      [
        "Woke session c14ca1fa (mode auto). It runs `cello inbox`, acts, answers on the card, then exits.",
        "Log: /data/runs/c14ca1fa-6f0e/x.jsonl",
        "Stop it with Stop on the card, or see its runs with `cello sessions runs c14ca1fa`.",
      ].join("\n"),
    )
  })
})

describe("runsText", () => {
  it("lists runs newest first: when, why, mode, how it ended and how long, and the log", () => {
    const start = run().startedAt
    expect(runsText("c14ca1fa-6f0e", [
      { run: run({ id: "2", why: "manual", startedAt: start + 3_600_000 }), log: "/l/2.jsonl" },
      { run: run({ outcome: "failed", endedAt: start + 90_000, exitCode: 1, error: "claude exited with code 1" }), log: "/l/1.jsonl" },
    ])).toBe(
      [
        "Woken runs of session c14ca1fa, newest first:",
        "  2026-11-16 16:58  cello sessions wake  auto  running",
        "    /l/2.jsonl",
        "  2026-11-16 15:58  a comment            auto  failed after 2 min: claude exited with code 1",
        "    /l/1.jsonl",
      ].join("\n"),
    )
    expect(runsText("c14ca1fa", [])).toBe("Cello hasn't woken session c14ca1fa.")
  })
})
