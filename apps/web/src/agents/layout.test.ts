import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, SessionAgent, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import type { Working, WorkingAgent } from "../presence/model.ts"
import {
  agentGroups,
  agentRows,
  directTasks,
  finishedRows,
  groupOf,
  logLinkOf,
  parseAgentsSearch,
  rowKeysOf,
  stateTaskOf,
  subagentsLabel,
  waitingTaskOf,
} from "./layout.ts"

const EMPTY_BOARD: BoardState = {
  seq: 1, actors: {}, workspaces: {}, projects: {}, statuses: {}, labels: {}, tasks: {}, sessions: {}, agents: {}, reviews: {}, asks: {}, documents: {}, wakes: {}, testOutcomes: {}, milestones: {},
}

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
  it("reads the open row, and drops anything else", () => {
    expect(parseAgentsSearch({ open: "agent:s1/a1" })).toEqual({ open: "agent:s1/a1" })
    expect(parseAgentsSearch({ open: "session:s1", agents: "b" })).toEqual({ open: "session:s1" })
    expect(parseAgentsSearch({ open: "CEL-4" })).toEqual({})
    expect(parseAgentsSearch({ open: 4 })).toEqual({})
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

describe("waitingTaskOf", () => {
  it("the task it's waiting on Lucas about, wherever it is among the ones it holds; none when it isn't waiting", () => {
    const a = session("2fd0505c")
    const [t1, t2] = [task("t1", "CEL-1"), { ...task("t2", "CEL-2"), statusId: "needs" }]
    const statuses = {
      prog: { name: "In Progress", category: "started" },
      needs: { name: "Needs input", category: "waiting" },
    }
    const [row] = agentRows([working(a, { tasks: [t1, t2], mark: { mood: "waiting", statusId: "needs" } })])
    expect(waitingTaskOf(row!, statuses)?.key).toBe("CEL-2")
    expect(waitingTaskOf({ ...row!, tasks: [t1] }, statuses)).toBeUndefined()
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

  it("the keys walk the rows in the order the groups show them", () => {
    const a = session("aaaa0000")
    const b = session("bbbb0000")
    const rows = agentRows([working(a, { agents: [sub(a, "a1", null)] }), working(b, { mark: { mood: "waiting", statusId: "needs" } })])
    expect(rowKeysOf(agentGroups(rows))).toEqual(["session:bbbb0000", "session:aaaa0000", "agent:aaaa0000/a1"])
  })

  it("CEL-104: a session's quiet subagents stay under it, in its group, instead of moving to Quiet on their own", () => {
    const a = session("2fd0505c")
    const t = task("t1", "CEL-74")
    const quietSub = { ...sub(a, "a1", t), presence: "idle" as const, mark: { mood: "still" as const, statusId: "prog" } }
    const rows = agentRows([working(a, { tasks: [t], agents: [quietSub, { ...quietSub, agent: { ...quietSub.agent, agentId: "a2" } }] })])
    expect(agentGroups(rows).map((g) => [g.id, g.rows.map((r) => r.id)])).toEqual([
      ["working", ["session:2fd0505c", "agent:2fd0505c/a1", "agent:2fd0505c/a2"]],
    ])
  })

  it("CEL-104: a family goes where its most pressing member is: a subagent waiting on Lucas brings its session to Waiting", () => {
    const a = session("aaaa0000")
    const waitingSub = sub(a, "a1", null, "waiting")
    const rows = agentRows([working(a, { presence: "idle", mark: { mood: "still", statusId: "prog" }, agents: [waitingSub] })])
    expect(agentGroups(rows).map((g) => [g.id, g.rows.map((r) => r.id)])).toEqual([["waiting", ["session:aaaa0000", "agent:aaaa0000/a1"]]])
  })

  it("leaves out empty groups", () => {
    expect(agentGroups(agentRows([working(session("aaaa0000"))])).map((g) => g.id)).toEqual(["working"])
  })

  it("CEL-133: a subagent waiting on its own background work is working, even once it has gone quiet; its quiet session follows it", () => {
    const a = session("bbbb0000")
    const quiet = sub(a, "a1", null)
    const waitingOnTests = { ...quiet, presence: "idle" as const, agent: { ...quiet.agent, waitingOn: ["Bash · bun run test:e2e"] } }
    const rows = agentRows([working(a, { presence: "idle", agents: [waitingOnTests] })])
    expect(groupOf(rows[1]!)).toBe("working")
    expect(agentGroups(rows).map((g) => [g.id, g.rows.map((r) => r.id)])).toEqual([["working", ["session:bbbb0000", "agent:bbbb0000/a1"]]])
  })
})

describe("stateTaskOf (CEL-104)", () => {
  const statuses = { prog: { name: "In Progress", category: "started" }, needs: { name: "Needs input", category: "waiting" } }

  it("an orchestrator shows the state of the task it holds, like any session, even when its subagents are quiet or gone", () => {
    const a = session("64a2ac46")
    const t = task("t1", "FE-70")
    const [orchestrator] = agentRows([working(a, { tasks: [t], agents: [sub(a, "a1", t)] })])
    expect(stateTaskOf(orchestrator!, statuses)?.key).toBe("FE-70")
    // Its subagents gone: still its task's state.
    expect(stateTaskOf({ ...orchestrator!, subagents: 0 }, statuses)?.key).toBe("FE-70")
  })

  it("the task waiting on Lucas wins over the first one; no task, none", () => {
    const a = session("aaaa0000")
    const [t1, t2] = [task("t1", "CEL-1"), { ...task("t2", "CEL-2"), statusId: "needs" }]
    const [row] = agentRows([working(a, { tasks: [t1, t2], mark: { mood: "waiting", statusId: "needs" } })])
    expect(stateTaskOf(row!, statuses)?.key).toBe("CEL-2")
    expect(stateTaskOf({ ...row!, tasks: [] }, statuses)).toBeUndefined()
  })
})

describe("subagentsLabel (CEL-104)", () => {
  it("counts its subagents in singular or plural", () => {
    expect(subagentsLabel(1)).toBe("1 subagent")
    expect(subagentsLabel(3)).toBe("3 subagents")
  })
})

describe("Finished today (CEL-107)", () => {
  const a = session("2fd0505c")
  const t = task("t1", "CEL-7")
  const done: SessionAgent = {
    sessionId: a.id, agentId: "a13bfb89", agentType: "cello-builder", taskId: "t1", description: "CEL-7 timer", startedAt: now - 600_000,
    lastSeenAt: now - 120_000, endedAt: now - 60_000,
  }
  const board: BoardState = {
    ...EMPTY_BOARD,
    statuses: { prog: { id: "prog", workspaceId: "w1", name: "In Progress", category: "started", position: "a", color: "#000", hidden: false, createdAt: 1, updatedAt: 1 } },
    sessions: { [a.id]: a },
    agents: { [`${a.id}/a13bfb89`]: done },
    tasks: { t1: t },
  }
  const ended = { ...a, id: "9a8b7c6d", externalId: "9a8b7c6d-417a", endedAt: now - 300_000 }
  const finished = finishedRows(board, [
    { session: a, agent: done, endedAt: done.endedAt!, tasks: [t] },
    { session: ended, agent: null, endedAt: ended.endedAt, tasks: [] },
  ])

  it("each finished agent is a row with the same id as when it worked, its end and its task", () => {
    expect(finished.map((r) => [r.id, r.kind, r.role, r.presence, r.endedAt, r.tasks.map((x) => x.key), r.who.name])).toEqual([
      ["agent:2fd0505c/a13bfb89", "agent", "cello-builder", "ended", now - 60_000, ["CEL-7"], "cello-builder · a13bfb89"],
      ["session:9a8b7c6d", "session", "session", "ended", now - 300_000, [], "Claude Code session 9a8b7c6d"],
    ])
    expect(finished[0]!.who.parentShort).toBe("2fd0505c")
    expect(finished[0]!.mark.mood).toBe("still")
  })

  it("they go last, in their own group, whatever group their session is in; the keys walk them too", () => {
    const rows = agentRows([working(a, { mark: { mood: "waiting", statusId: "needs" } })])
    const groups = agentGroups(rows, finished)
    expect(groups.map((g) => [g.id, g.label, g.rows.map((r) => r.id)])).toEqual([
      ["waiting", "Waiting on you", ["session:2fd0505c"]],
      ["finished", "Finished today", ["agent:2fd0505c/a13bfb89", "session:9a8b7c6d"]],
    ])
    expect(rowKeysOf(groups).at(-1)).toBe("session:9a8b7c6d")
    expect(groupOf(finished[0]!)).toBe("finished")
  })
})

describe("logLinkOf: the task panel's Log link (CEL-107)", () => {
  const a = session("2fd0505c")
  const builder: SessionAgent = {
    sessionId: a.id, agentId: "a13bfb89", agentType: "cello-builder", taskId: "t1", description: null, startedAt: now, lastSeenAt: now, endedAt: null,
  }
  const board = (s: AgentSession, ag: SessionAgent[] = []): BoardState =>
    ({ ...EMPTY_BOARD, sessions: { [s.id]: s }, agents: Object.fromEntries(ag.map((x) => [`${x.sessionId}/${x.agentId}`, x])) })

  it("opens the Agents page on the holder's row: the subagent's, else the session's", () => {
    expect(logLinkOf(board(a, [builder]), { session: a, agent: builder }, now)).toBe("agent:2fd0505c/a13bfb89")
    expect(logLinkOf(board(a), { session: a, agent: null }, now)).toBe("session:2fd0505c")
  })

  it("while the row is on the page: working, or finished today; not for the human, or an agent that finished before today", () => {
    const today = { ...a, endedAt: now - 60_000 }
    expect(logLinkOf(board(today), { session: today, agent: null }, now)).toBe("session:2fd0505c")
    const old = { ...a, endedAt: now - 2 * 86_400_000 }
    expect(logLinkOf(board(old), { session: old, agent: null }, now)).toBeNull()
    expect(logLinkOf(board(a), { session: null, agent: null }, now)).toBeNull()
  })
})
