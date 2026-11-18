// Values a newer server may send that this build doesn't know (CEL-143): an older board lost its whole
// snapshot on a wake reason (`approved`) it couldn't read. Wake reasons and not-woken reasons inside a
// task's wake or a woken run read as `other` instead, which the board shows generically.
import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"
import { SessionAgent, SessionRun, TaskWake } from "./entities.ts"
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
