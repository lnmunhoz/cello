import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, SessionAgent, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import type { Working, WorkingAgent } from "../presence/model.ts"
import {
  type AgentRow,
  type AgentSort,
  agentGroups,
  agentRows,
  agentProjectIds,
  directTasks,
  filterAgentRows,
  finishedRows,
  foldedLabel,
  foldFinished,
  groupOf,
  homeProjectOf,
  logLinkOf,
  parseAgentsSearch,
  pulseKeyOf,
  rowKeysOf,
  searchAgentRows,
  shelterOf,
  sortFamilies,
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

describe("searchAgentRows: the search box keeps each family whole (CEL-190)", () => {
  const a = session("2fd0505c")
  const b = session("8a41c9e2")
  const [t1, t2, t3] = [{ ...task("t1", "CEL-1"), title: "Fold the rows" }, { ...task("t2", "CEL-2"), title: "Prices in baht" }, { ...task("t3", "THAI-3"), title: "Search box" }]
  const rows = agentRows([working(a, { tasks: [t1, t2], agents: [sub(a, "a13bfb89", t1), sub(a, "b77d0e11", t2)] }), working(b, { tasks: [t3] })])
  const found = (query: string) => searchAgentRows(rows, query).map((r) => r.id)

  it("no query is every row, in order", () => {
    expect(found("")).toEqual(rows.map((r) => r.id))
  })

  it("finds a session by its name or a task's key or title", () => {
    expect(found("8a41")).toEqual(["session:8a41c9e2"])
    expect(found("thai-3")).toEqual(["session:8a41c9e2"])
    expect(found("search box")).toEqual(["session:8a41c9e2"])
  })

  it("a subagent that matches brings its session and the other subagents; a session that matches brings its subagents", () => {
    const family = ["session:2fd0505c", "agent:2fd0505c/a13bfb89", "agent:2fd0505c/b77d0e11"]
    expect(found("b77d0e11")).toEqual(family)
    expect(found("2fd0")).toEqual(family)
    expect(found("baht")).toEqual(family)
  })

  it("a finished row stands on its own", () => {
    const finished = rows.map((r) => ({ ...r, id: `done:${r.id}`, endedAt: now }))
    expect(searchAgentRows(finished, "b77d0e11").map((r) => r.id)).toEqual(["done:agent:2fd0505c/b77d0e11"])
  })

  it("nothing matches nothing", () => {
    expect(found("zzz")).toEqual([])
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

describe("foldFinished: finished subagents fold into their session's row (CEL-156)", () => {
  const a = session("2fd0505c")
  const t = task("t1", "CEL-7")
  const finishedSub = (s: AgentSession, agentId: string, agentType: string | null, endedAt: number, startedAt = now - 600_000) =>
    finishedRows(EMPTY_BOARD, [{ session: s, agent: { sessionId: s.id, agentId, agentType, taskId: t.id, description: null, startedAt, lastSeenAt: endedAt, endedAt }, endedAt, tasks: [t] }])[0]!
  const types = ["cello-builder", "cello-builder", "cello-code-reviewer"]
  const subs = types.map((type, i) => finishedSub(a, `a${i}`, type, now - 60_000 * (i + 1), now - 600_000 + i))
  const working = agentRows([{ session: a, who: { kind: "agent", name: "s", short: "s", color: "#111" }, presence: "active", tasks: [t], agents: [], mark: { mood: "thinking", statusId: "" } }])

  it("a finished subagent folds under its working session, in start order, and has no row of its own", () => {
    const folded = foldFinished(working, subs)
    expect(folded.finished).toEqual([])
    expect(folded.rows.map((r) => [r.id, r.folded.map((f) => f.id)])).toEqual([["session:2fd0505c", ["agent:2fd0505c/a0", "agent:2fd0505c/a1", "agent:2fd0505c/a2"]]])
  })

  it("under a finished session's row when the session itself finished; the session keeps its row", () => {
    const ended = finishedSub(a, "x", null, now - 5_000)
    const session1 = finishedRows(EMPTY_BOARD, [{ session: { ...a, endedAt: now - 5_000 }, agent: null, endedAt: now - 5_000, tasks: [t] }])
    expect(ended.kind).toBe("agent")
    const folded = foldFinished([], [...session1, ...subs])
    expect(folded.finished.map((r) => [r.id, r.folded.length])).toEqual([["session:2fd0505c", 3]])
  })

  it("a subagent whose session isn't on the page keeps its own row, as before; sessions never fold", () => {
    const b = session("8a41c9e2")
    const orphan = finishedSub(b, "o1", "cello-builder", now - 1_000)
    const folded = foldFinished(working, [orphan, ...subs])
    expect(folded.finished.map((r) => r.id)).toEqual(["agent:8a41c9e2/o1"])
    expect(folded.rows[0]!.folded).toHaveLength(3)
  })

  it("a working subagent is never folded, and a family's folds stay with their session", () => {
    const b = session("8a41c9e2")
    const rows = agentRows([{ session: b, who: { kind: "agent", name: "b", short: "b", color: "#111" }, presence: "active", tasks: [], agents: [sub(b, "w1", t)], mark: { mood: "thinking", statusId: "" } }, ...[]])
    const folded = foldFinished([...working, ...rows], subs)
    expect(folded.rows.map((r) => [r.id, r.folded.length])).toEqual([["session:2fd0505c", 3], ["session:8a41c9e2", 0], ["agent:8a41c9e2/w1", 0]])
  })

  it("the line counts by type, in start order: 2 builders, 1 reviewer", () => {
    expect(foldedLabel(subs)).toBe("2 builders, 1 code reviewer finished")
    expect(foldedLabel(subs.slice(2))).toBe("1 code reviewer finished")
    expect(foldedLabel([finishedSub(a, "z", null, now)])).toBe("1 agent finished")
  })

  it("the keys walk a fold's rows right after their session, only while it's open", () => {
    const folded = foldFinished(working, subs)
    const groups = agentGroups(folded.rows)
    expect(rowKeysOf(groups)).toEqual(["session:2fd0505c"])
    expect(rowKeysOf(groups, { older: false, folds: new Set(["session:2fd0505c"]) })).toEqual(["session:2fd0505c", "agent:2fd0505c/a0", "agent:2fd0505c/a1", "agent:2fd0505c/a2"])
  })

  it("a link to a row inside a fold says which fold holds it", () => {
    const groups = agentGroups(foldFinished(working, subs).rows)
    expect(shelterOf(groups, "agent:2fd0505c/a1")).toEqual({ older: false, fold: "session:2fd0505c" })
    expect(shelterOf(groups, "session:2fd0505c")).toEqual({ older: false, fold: null })
    expect(shelterOf(groups, "agent:nobody/x")).toEqual({ older: false, fold: null })
  })

  it("a folded subagent is found by search with its session, and counts for the session's project", () => {
    const folded = foldFinished(working, subs).rows
    expect(searchAgentRows(folded, "a1").map((r) => r.id)).toEqual(["session:2fd0505c"])
    const bare = foldFinished(agentRows([{ session: a, who: { kind: "agent", name: "s", short: "s", color: "#111" }, presence: "active", tasks: [], agents: [], mark: { mood: "thinking", statusId: "" } }]), subs).rows
    expect(homeProjectOf(bare[0]!, bare, {})).toBe("p1")
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

describe("pulseKeyOf (CEL-186)", () => {
  it("changes when the row's agent makes a call (lastSeenAt), and only then: a subagent's own, a session's own", () => {
    const s = session("s1")
    const a = sub(s, "a1", null)
    const [sessionRow, agentRow] = agentRows([working(s, { agents: [a] })])
    const later = { ...a, agent: { ...a.agent, lastSeenAt: a.agent.lastSeenAt + 1000 } }
    const [sessionRow2, agentRow2] = agentRows([working(s, { agents: [later] })])
    expect(pulseKeyOf(agentRow2!)).not.toBe(pulseKeyOf(agentRow!))
    expect(pulseKeyOf(sessionRow2!)).toBe(pulseKeyOf(sessionRow!))
    const [sessionRow3] = agentRows([working({ ...s, lastSeenAt: s.lastSeenAt + 1000 }, { agents: [a] })])
    expect(pulseKeyOf(sessionRow3!)).not.toBe(pulseKeyOf(sessionRow!))
  })
})

describe("sortFamilies: the Agents page's order (CEL-188)", () => {
  const statuses = { prog: { name: "In Progress", category: "started" } }
  const names: Record<string, string> = { pa: "Alpha", pb: "Beta" }
  const onTask = (id: string, key: string, projectId: string, number: number): Task => ({ ...task(id, key), projectId, number })
  const [s1, s2, s3] = [{ ...session("s1"), lastSeenAt: now - 300_000 }, { ...session("s2"), lastSeenAt: now - 100_000 }, { ...session("s3"), lastSeenAt: now - 200_000 }]
  // Started order: s1 (Beta 2), s2 (Alpha 9, with a subagent seen most recently), s3 (Beta 1), s4 (no task).
  const busy = { ...sub(s1, "a1", null), agent: { ...sub(s1, "a1", null).agent, lastSeenAt: now - 400_000 } }
  const lively = { ...sub(s2, "a2", null), agent: { ...sub(s2, "a2", null).agent, lastSeenAt: now } }
  const rows = agentRows([
    working(s1, { tasks: [onTask("t1", "B-2", "pb", 2)], agents: [busy] }),
    working(s2, { tasks: [onTask("t2", "A-9", "pa", 9)], agents: [lively] }),
    working(s3, { tasks: [onTask("t3", "B-1", "pb", 1)] }),
    working(session("s4")),
  ])
  const ids = (sorted: ReadonlyArray<AgentRow>) => sorted.map((r) => r.id)
  const sorted = (sort: AgentSort) => ids(sortFamilies(rows, sort, (id) => names[id]!, statuses))

  it("Started leaves the order alone", () => {
    expect(sorted("started")).toEqual(ids(rows))
  })

  it("Last active puts the family whose agents checked in last first, subagents counted, each family whole", () => {
    expect(sorted("active")).toEqual(["session:s2", "agent:s2/a2", "session:s4", "session:s3", "session:s1", "agent:s1/a1"])
  })

  it("Project goes by the project's name, a family with none last, subagents under their session", () => {
    expect(sorted("project")).toEqual(["session:s2", "agent:s2/a2", "session:s1", "agent:s1/a1", "session:s3", "session:s4"])
  })

  it("Task goes by the first task's project, then its number, rows with no task last", () => {
    expect(sorted("task")).toEqual(["session:s2", "agent:s2/a2", "session:s3", "session:s1", "agent:s1/a1", "session:s4"])
  })
})

describe("homeProjectOf and filterAgentRows: the Agents page narrowed to a project (CEL-188)", () => {
  const statuses = { prog: { name: "In Progress", category: "started" } }
  const inProject = (t: Task, projectId: string): Task => ({ ...t, projectId })

  it("a session's project is the task its row shows; with none, its first subagent's task; with no task at all, none", () => {
    const a = session("sa")
    const b = session("sb")
    const c = session("sc")
    const rows = agentRows([
      working(a, { tasks: [inProject(task("t1", "A-1"), "pa")] }),
      working(b, { agents: [sub(b, "b1", inProject(task("t2", "B-1"), "pb"))] }),
      working(c),
    ])
    expect(rows.map((r) => homeProjectOf(r, rows, statuses))).toEqual(["pa", "pb", "pb", null])
  })

  it("a subagent on another project stays under its session's project: a family is never split", () => {
    const a = session("sa")
    const rows = agentRows([working(a, { tasks: [inProject(task("t1", "A-1"), "pa")], agents: [sub(a, "a1", inProject(task("t2", "B-1"), "pb"))] })])
    expect(filterAgentRows(rows, "pa", statuses).map((r) => r.id)).toEqual(["session:sa", "agent:sa/a1"])
    expect(filterAgentRows(rows, "pb", statuses)).toEqual([])
  })

  it("All keeps every row, rows with no project too; a project drops them", () => {
    const rows = agentRows([working(session("sa"), { tasks: [inProject(task("t1", "A-1"), "pa")] }), working(session("sb"))])
    expect(filterAgentRows(rows, null, statuses).map((r) => r.id)).toEqual(["session:sa", "session:sb"])
    expect(filterAgentRows(rows, "pa", statuses).map((r) => r.id)).toEqual(["session:sa"])
  })

  it("agentProjectIds counts the finished rows too, so a project whose only agents finished today still has its chip", () => {
    const live = agentRows([working(session("sa"), { tasks: [inProject(task("t1", "A-1"), "pa")] })])
    const finished = finishedRows(EMPTY_BOARD, [{ session: session("sf"), agent: null, tasks: [inProject(task("t9", "B-1"), "pb")], endedAt: now }])
    expect(agentProjectIds(live, finished, statuses)).toEqual(["pa", "pb"])
    // The same ids the filter uses: picking pb shows the finished row.
    expect(filterAgentRows(finished, "pb", statuses).map((r) => r.id)).toEqual(["session:sf"])
  })

  it("a finished row stands on its own: its own task's project", () => {
    const [row] = finishedRows(EMPTY_BOARD, [{ session: session("sf"), agent: null, tasks: [inProject(task("t1", "A-1"), "pa")], endedAt: now }])
    expect(homeProjectOf(row!, [], statuses)).toBe("pa")
  })
})
