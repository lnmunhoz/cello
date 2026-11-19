// Values a newer server may send that this build doesn't know (CEL-143): an older board lost its whole
// snapshot on a wake reason (`approved`) it couldn't read. Wake reasons and not-woken reasons inside a
// task's wake or a woken run read as `other` instead, which the board shows generically.
import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"
import { AgentSession, SessionAgent, SessionRun, Status, TaskWake, TestRun } from "./entities.ts"
import { NOT_WOKEN_TEXT, WAKE_WHY_TEXT } from "./wake.ts"

const run = {
  id: "r1", sessionId: "s1", taskId: "t1", why: "comment", agentKind: "claude-code", mode: "auto", celloMode: "auto",
  pid: 1, startedAt: 1, endedAt: null, exitCode: null, outcome: "running", error: null,
}

describe("wake reasons a newer server added", () => {
  it("a woken run with a reason this build doesn't know reads as other; known ones as they are", () => {
    expect(Schema.decodeUnknownSync(SessionRun)({ ...run, why: "test.from-a-newer-build" }).why).toBe("other")
    expect(Schema.decodeUnknownSync(SessionRun)({ ...run, why: "approved" }).why).toBe("approved")
    // The server sends what it always did.
    expect(Schema.encodeSync(SessionRun)({ ...run, why: "approved" } as SessionRun).why).toBe("approved")
  })

  it("a task's wake with an unknown reason or not-woken reason reads as other, so the snapshot still loads", () => {
    const wake = Schema.decodeUnknownSync(TaskWake)({
      taskId: "t1", sessionId: "s1", state: "not_woken", why: "test.new-why", ts: 1, at: null, reason: "test.new-reason", run: null,
    })
    expect(wake).toMatchObject({ why: "other", reason: "other" })
    expect(WAKE_WHY_TEXT.other).toBe("something this version of Cello doesn't know yet")
    expect(NOT_WOKEN_TEXT.other).toBe("a reason this version of Cello doesn't know yet")
  })
})

// CEL-181: a test run knows its task, and an agent's presence carries all its kept runs. Both keys are optional,
// because runs stored in `tests_json` and presence events stored before them have neither.
describe("a test run's task and an agent's runs", () => {
  const testRun = { label: "web e2e", command: "bun run test:e2e", startedAt: 1, endedAt: null, outcome: null, background: true, progress: null }
  const agent = { sessionId: "s1", agentId: "a1", agentType: "cello-builder", taskId: null, description: null, startedAt: 1, lastSeenAt: 2, endedAt: null }
  const session = { id: "s1", actorId: "a1", externalId: null, clientName: "claude-code", entrypoint: null, cwd: null, pid: null, startedAt: 1, lastSeenAt: 2, endedAt: null }

  it("a run stored before it has no task still decodes; with one, a task or null, it is kept", () => {
    expect(Schema.decodeUnknownSync(TestRun)(testRun).taskId).toBeUndefined()
    expect(Schema.decodeUnknownSync(TestRun)({ ...testRun, taskId: "t1" }).taskId).toBe("t1")
    expect(Schema.decodeUnknownSync(TestRun)({ ...testRun, taskId: null }).taskId).toBeNull()
  })

  it("a session and a subagent decode with and without their runs", () => {
    expect(Schema.decodeUnknownSync(SessionAgent)(agent).runs).toBeUndefined()
    expect(Schema.decodeUnknownSync(AgentSession)(session).runs).toBeUndefined()
    expect(Schema.decodeUnknownSync(SessionAgent)({ ...agent, runs: [{ ...testRun, taskId: "t1" }] }).runs?.[0]?.taskId).toBe("t1")
    expect(Schema.decodeUnknownSync(AgentSession)({ ...session, runs: [] }).runs).toEqual([])
  })
})

// CEL-160: a reviewer's verdict on its agent row; a build that doesn't know a verdict reads it as other.
describe("a subagent's verdict", () => {
  const agent = { sessionId: "s1", agentId: "a1", agentType: "cello-code-reviewer", taskId: "t1", description: null, startedAt: 1, lastSeenAt: 2, endedAt: 3 }

  it("decodes without one (events stored before CEL-160), and as the stored word", () => {
    expect(Schema.decodeUnknownSync(SessionAgent)(agent).verdict).toBeUndefined()
    expect(Schema.decodeUnknownSync(SessionAgent)({ ...agent, verdict: null }).verdict).toBeNull()
    expect(Schema.decodeUnknownSync(SessionAgent)({ ...agent, verdict: "fix_first" }).verdict).toBe("fix_first")
    expect(Schema.encodeSync(SessionAgent)({ ...agent, verdict: "merge" } as SessionAgent).verdict).toBe("merge")
  })

  it("a verdict a newer server added reads as other", () => {
    expect(Schema.decodeUnknownSync(SessionAgent)({ ...agent, verdict: "test.from-a-newer-build" }).verdict).toBe("other")
  })
})

// CEL-152: a subagent's own folder, optional so builds of either age read each other's events.
describe("a subagent's own folder", () => {
  const agent = { sessionId: "s1", agentId: "a1", agentType: "cello-builder", taskId: "t1", description: null, startedAt: 1, lastSeenAt: 2, endedAt: null }

  it("decodes without one (events stored before CEL-152, an older server), as null, and as the folder", () => {
    expect(Schema.decodeUnknownSync(SessionAgent)(agent).cwd).toBeUndefined()
    expect(Schema.decodeUnknownSync(SessionAgent)({ ...agent, cwd: null }).cwd).toBeNull()
    expect(Schema.decodeUnknownSync(SessionAgent)({ ...agent, cwd: "/work/wt-a" }).cwd).toBe("/work/wt-a")
    expect(Schema.encodeSync(SessionAgent)({ ...agent, cwd: "/work/wt-a" } as SessionAgent).cwd).toBe("/work/wt-a")
  })

  it("an older build, which has no such field, still decodes a newer server's agent and drops the folder", () => {
    const { cwd: _cwd, ...fields } = SessionAgent.fields
    const older = Schema.decodeUnknownSync(Schema.Struct(fields))({ ...agent, cwd: "/work/wt-a" })
    expect(older).not.toHaveProperty("cwd")
    expect(older.agentId).toBe("a1")
  })
})

// CEL-178 phase 0: a status category a newer server adds (an `approved` column, say) must not cost an older
// board or CLI its whole snapshot; it reads as `other`, which the board draws generically.
describe("status categories a newer server added", () => {
  const status = {
    id: "s1", workspaceId: "w1", name: "Approved", category: "later", position: "a0", color: "#10B981", hidden: false, createdAt: 1, updatedAt: 1,
  }

  it("a status with a category this build doesn't know reads as other", () => {
    expect(Schema.decodeUnknownSync(Status)(status).category).toBe("other")
  })

  it("every known category reads as itself, and encodes as itself", () => {
    for (const category of ["backlog", "unstarted", "started", "waiting", "completed", "canceled"] as const) {
      const decoded = Schema.decodeUnknownSync(Status)({ ...status, category })
      expect(decoded.category).toBe(category)
      expect(Schema.encodeSync(Status)(decoded).category).toBe(category)
    }
  })
})
