import type { AgentSession, SessionAgent, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import type { Working, WorkingAgent } from "../presence/model.ts"
import { agentGroups, agentRows, directTasks, parseAgentsSearch } from "./layout.ts"

const now = Date.UTC(2026, 10, 16, 12)

const session = (id: string): AgentSession => ({
  id, actorId: "claude", externalId: `${id}-417a`, clientName: "Claude Code", entrypoint: "cli", cwd: "/repo", pid: 1,
  startedAt: now - 3_600_000, lastSeenAt: now - 60_000, endedAt: null,
})

const task = (id: string, key: string): Task => ({
  id, projectId: "p1", number: 1, key, title: id, description: "", statusId: "prog", priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: "claude", assigneeSessionId: null, createdByActorId: "lucas",
  createdBySessionId: null, updatedByActorId: "lucas", updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1,
  createdAt: now, updatedAt: now, archivedAt: null,
})

const sub = (s: AgentSession, agentId: string, t: Task | null, mood: WorkingAgent["mark"]["mood"] = "working"): WorkingAgent => {
  const agent: SessionAgent = {
    sessionId: s.id, agentId, agentType: "cello-builder", taskId: t?.id ?? null, description: null, startedAt: now, lastSeenAt: now, endedAt: null,
  }
  return {
    agent, who: { kind: "agent", name: `cello-builder · ${agentId}`, short: `cello-builder · ${agentId}`, color: "#000" },
    presence: "active", task: t, mark: { mood, statusId: "prog" },
  }
}

const working = (s: AgentSession, extra: Partial<Working> = {}): Working => ({
  session: s, who: { kind: "agent", name: `Claude Code session ${s.id}`, short: s.id, color: "#111" },
  presence: "active", tasks: [], agents: [], mark: { mood: "thinking", statusId: "" }, ...extra,
})

describe("parseAgentsSearch", () => {
  it("reads the prototype's layout and the open row, and drops anything else", () => {
    expect(parseAgentsSearch({ agents: "b", open: "agent:s1/a1" })).toEqual({ agents: "b", open: "agent:s1/a1" })
    expect(parseAgentsSearch({ agents: "z", open: 4 })).toEqual({})
    expect(parseAgentsSearch({})).toEqual({})
  })
})

describe("agentRows", () => {
  it("lists each session, then its subagents under it, with the tasks they're on", () => {
    const a = session("2fd0505c")
    const t1 = task("t1", "CEL-1")
    const t2 = task("t2", "CEL-2")
    const rows = agentRows([working(a, { tasks: [t1, t2], agents: [sub(a, "a13bfb89", t1), sub(a, "b77d0e11", t2)] })])
    expect(rows.map((r) => [r.id, r.role, r.tasks.map((t) => t.key)])).toEqual([
      ["session:2fd0505c", "orchestrator", ["CEL-1", "CEL-2"]],
      ["agent:2fd0505c/a13bfb89", "cello-builder", ["CEL-1"]],
      ["agent:2fd0505c/b77d0e11", "cello-builder", ["CEL-2"]],
    ])
    expect(rows[1]!.parent?.session.id).toBe("2fd0505c")
  })

  it("leaves out ended sessions; a session alone is a session, not an orchestrator", () => {
    const rows = agentRows([working(session("8a41c9e2")), working(session("dead0000"), { presence: "ended" })])
    expect(rows.map((r) => [r.id, r.role])).toEqual([["session:8a41c9e2", "session"]])
  })
})

describe("directTasks", () => {
  it("gives an orchestrator only the tasks none of its subagents is on, and a subagent its own", () => {
    const a = session("2fd0505c")
    const [t1, t2, t3] = [task("t1", "CEL-1"), task("t2", "CEL-2"), task("t3", "CEL-3")]
    const rows = agentRows([working(a, { tasks: [t1, t2, t3], agents: [sub(a, "a1", t1), sub(a, "a2", t2)] })])
    expect(directTasks(rows[0]!, rows).map((t) => t.key)).toEqual(["CEL-3"])
    expect(directTasks(rows[1]!, rows).map((t) => t.key)).toEqual(["CEL-1"])
  })
})

describe("agentGroups", () => {
  it("puts agents waiting on Lucas first, then the ones working, then the quiet ones", () => {
    const a = session("aaaa0000")
    const b = session("bbbb0000")
    const c = session("cccc0000")
    const rows = agentRows([
      working(a, { agents: [sub(a, "a1", null)] }),
      working(b, { mark: { mood: "waiting", statusId: "needs" } }),
      working(c, { presence: "idle", mark: { mood: "still", statusId: "prog" } }),
    ])
    expect(agentGroups(rows).map((g) => [g.id, g.rows.map((r) => r.id)])).toEqual([
      ["waiting", ["session:bbbb0000"]],
      ["working", ["session:aaaa0000", "agent:aaaa0000/a1"]],
      ["quiet", ["session:cccc0000"]],
    ])
  })

  it("leaves out empty groups", () => {
    expect(agentGroups(agentRows([working(session("aaaa0000"))])).map((g) => g.id)).toEqual(["working"])
  })
})
