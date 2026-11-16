import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, SessionRun, Task, TaskWake } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { wakeLine } from "./wakeLine.ts"

const now = Date.UTC(2026, 10, 16, 15)
const session: AgentSession = {
  id: "s1", actorId: "claude", externalId: "c14ca1fa-6f0e", clientName: "Claude Code", entrypoint: "cli", cwd: "/repo", pid: 7,
  startedAt: now - 3_600_000, lastSeenAt: now - 600_000, endedAt: now - 500_000,
}
const task = { id: "t1", assigneeSessionId: "s1" } as Task
const run: SessionRun = {
  id: "r1", sessionId: "s1", taskId: "t1", why: "comment", agentKind: "claude-code", mode: "auto", celloMode: "auto", pid: 9,
  startedAt: now - 120_000, endedAt: null, exitCode: null, outcome: "running", error: null,
}
const wake = (w: Partial<TaskWake>): TaskWake => ({ taskId: "t1", sessionId: "s1", state: "scheduled", why: "comment", ts: now - 10_000, at: now + 20_000, reason: null, run: null, ...w })
const board = (w: TaskWake | null, s: AgentSession = session): BoardState =>
  ({ sessions: { s1: s }, wakes: w ? { t1: w } : {} }) as unknown as BoardState

describe("wakeLine (CEL-92)", () => {
  it("before: the session isn't running and Cello will wake it, with Don't wake", () => {
    expect(wakeLine(task, board(wake({})), now)).toEqual({ kind: "scheduled", text: "Session c14ca1fa isn't running. Cello will wake it in 30 s", at: now + 20_000 })
  })
  it("during: woken by Cello, running, with Stop and its log", () => {
    expect(wakeLine(task, board(wake({ state: "running", run, at: null })), now)).toEqual({ kind: "running", text: "Woken by Cello · running", runId: "r1" })
  })
  it("after: how the run ended, until the session comes back by itself", () => {
    const ended = { ...run, endedAt: now - 60_000, outcome: "completed" as const, exitCode: 0 }
    expect(wakeLine(task, board(wake({ state: "ended", run: ended, at: null })), now)).toEqual({ kind: "ended", text: "Woken by Cello 1m ago · completed in 1 min", runId: "r1" })
    const failed = { ...ended, outcome: "failed" as const, error: "claude exited with code 1" }
    expect(wakeLine(task, board(wake({ state: "ended", run: failed, at: null })), now)?.text).toBe("Woken by Cello 1m ago · failed after 1 min: claude exited with code 1")
    expect(wakeLine(task, board(wake({ state: "ended", run: ended, at: null }), { ...session, lastSeenAt: now - 1_000, endedAt: null }), now)).toBeNull()
  })
  it("not woken: one line saying why; gone once the session checks in, and never for a comment it took itself", () => {
    expect(wakeLine(task, board(wake({ state: "not_woken", reason: "disabled", at: null })), now)).toEqual({ kind: "not_woken", text: "Not woken: waking is off for this project" })
    expect(wakeLine(task, board(wake({ state: "not_woken", reason: "disabled", at: null }), { ...session, lastSeenAt: now, endedAt: null }), now)).toBeNull()
    expect(wakeLine(task, board(wake({ state: "not_woken", reason: "taken", at: null })), now)).toBeNull()
  })
  it("nothing once another session holds the claim, or with no wake", () => {
    expect(wakeLine({ ...task, assigneeSessionId: "s2" }, board(wake({})), now)).toBeNull()
    expect(wakeLine(task, board(null), now)).toBeNull()
  })
})
