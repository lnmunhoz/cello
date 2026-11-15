import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, SessionAgent, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { agentMood, agentsWorkingCount, markEntry, type MarkSeen, provenanceLine, provenanceOf, whoOf, workingSessions } from "./model.ts"

const MIN = 60_000
const now = Date.UTC(2026, 10, 15, 12)

const session = (id: string, extra: Partial<AgentSession> = {}): AgentSession => ({
  id, actorId: "claude", externalId: `${id}-417a-4167`, clientName: "Claude Code", entrypoint: "cli", cwd: "/repo", pid: 1,
  startedAt: now - 60 * MIN, lastSeenAt: now - MIN, endedAt: null, ...extra,
})

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number: 1, key: "CEL-1", title: id, description: "", statusId: "prog", priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "lucas",
  createdBySessionId: null, updatedByActorId: "lucas", updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1,
  createdAt: Date.UTC(2026, 10, 14), updatedAt: Date.UTC(2026, 10, 14), archivedAt: null, ...extra,
})

const agent = (sessionId: string, agentId: string, extra: Partial<SessionAgent> = {}): SessionAgent => ({
  sessionId, agentId, agentType: "cello-builder", taskId: null, description: null,
  startedAt: now - 30 * MIN, lastSeenAt: now - MIN, endedAt: null, ...extra,
})

const board = (tasks: Task[], sessions: AgentSession[], agents: SessionAgent[] = []): BoardState => ({
  seq: 1,
  actors: {
    lucas: { id: "lucas", kind: "human", name: "Lucas N. Munhoz", client: null, color: "#5e6ad2", createdAt: 1 },
    claude: { id: "claude", kind: "agent", name: "Claude Code", client: "Claude Code", color: "#10b981", createdAt: 1 },
  },
  workspaces: {},
  projects: { p1: { id: "p1", workspaceId: "w1", name: "Cello", key: "CEL", color: "#000", description: "", repoPath: null, createdAt: 1, updatedAt: 1, archivedAt: null } },
  statuses: {},
  labels: {},
  tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
  sessions: Object.fromEntries(sessions.map((s) => [s.id, s])),
  agents: Object.fromEntries(agents.map((a) => [`${a.sessionId}/${a.agentId}`, a])),
  reviews: {},
  asks: {},
  documents: {},
})

describe("provenanceLine", () => {
  it("names the creator, and who changed it last and when", () => {
    const changed = task("t", { version: 4, updatedByActorId: "claude", updatedBySessionId: "8a41c9e2", updatedAt: now - 4 * MIN })
    const state = board([changed], [session("8a41c9e2")])
    expect(provenanceLine(provenanceOf(state, changed), now)).toBe("Lucas created · 8a41c9e2 changed 4m ago")
  })

  it("says it once when the creator changed it last, and gives the day when nobody changed it", () => {
    const own = task("t", { version: 2, updatedAt: now - 2 * 60 * MIN })
    expect(provenanceLine(provenanceOf(board([own], []), own), now)).toBe("Lucas created · changed 2h ago")
    const untouched = task("u")
    expect(provenanceLine(provenanceOf(board([untouched], []), untouched), now)).toBe("Lucas created Nov 14")
  })

  it("says commented when the latest activity is a comment, and changed once something else follows it", () => {
    const commented = task("t", {
      version: 5, updatedByActorId: "claude", updatedBySessionId: "2fd0505c", updatedAt: now - 10_000, commentCount: 1, lastCommentAt: now - 10_000,
    })
    const state = board([commented], [session("2fd0505c")])
    expect(provenanceLine(provenanceOf(state, commented), now)).toBe("Lucas created · 2fd0505c commented just now")
    const changedSince = { ...commented, updatedAt: now - 5_000 }
    expect(provenanceLine(provenanceOf(state, changedSince), now)).toBe("Lucas created · 2fd0505c changed just now")
  })

  it("an agent creator is its session; a session the board doesn't have yet falls back to the client's name", () => {
    const made = task("t", { createdByActorId: "claude", createdBySessionId: "2fd0505c" })
    expect(provenanceLine(provenanceOf(board([made], [session("2fd0505c")]), made), now)).toBe("2fd0505c created Nov 14")
    expect(provenanceLine(provenanceOf(board([made], []), made), now)).toBe("Claude Code created Nov 14")
  })
})

describe("provenanceOf", () => {
  it("knows the claim holder's session and the stage", () => {
    const held = task("t", { assigneeActorId: "claude", assigneeSessionId: "8a41c9e2", stage: "fixing" })
    const p = provenanceOf(board([held], [session("8a41c9e2")]), held)
    expect(p.holder).toMatchObject({ who: { name: "Claude Code session 8a41c9e2", short: "8a41c9e2" }, session: { id: "8a41c9e2" } })
    expect(p.stage?.label).toBe("Fixing findings")
  })

  it("a task Lucas holds has a holder with no session; an unclaimed one has none", () => {
    expect(provenanceOf(board([], []), task("t", { assigneeActorId: "lucas" })).holder).toMatchObject({ who: { short: "Lucas" }, session: null })
    expect(provenanceOf(board([], []), task("t")).holder).toBeNull()
  })
})

describe("workingSessions", () => {
  it("the sessions holding claims in the workspace, active ones first, each once with its tasks", () => {
    const sessions = [session("active1"), session("idle1", { lastSeenAt: now - 2 * 60 * MIN }), session("ended1", { endedAt: now - MIN }), session("active2")]
    const tasks = [
      task("a", { assigneeActorId: "claude", assigneeSessionId: "idle1" }),
      task("b", { assigneeActorId: "claude", assigneeSessionId: "active1" }),
      task("c", { assigneeActorId: "claude", assigneeSessionId: "active1" }),
      task("d", { assigneeActorId: "claude", assigneeSessionId: "ended1" }),
      task("e", { assigneeActorId: "claude", assigneeSessionId: "active2", archivedAt: 1 }),
      task("f", { assigneeActorId: "lucas" }),
    ]
    const working = workingSessions(board(tasks, sessions), "w1", now)
    expect(working.map((w) => [w.session.id, w.presence, w.tasks.map((t) => t.id)])).toEqual([
      ["active1", "active", ["b", "c"]],
      ["idle1", "idle", ["a"]],
      ["ended1", "ended", ["d"]],
    ])
  })
})

describe("agentMood (CEL-69)", () => {
  const inProgress = { name: "In Progress", category: "started" }
  const needsInput = { name: "Needs input", category: "waiting" }
  const inReview = { name: "In Review", category: "started" }
  const done = { name: "Done", category: "completed" }

  it("works while an active agent builds or fixes findings: the tip spins", () => {
    expect(agentMood("building", inProgress, "active")).toBe("working")
    expect(agentMood("fixing", inProgress, "active")).toBe("working")
  })

  it("thinks while an active agent holds it with no stage yet (planning) or in Agent review (reading)", () => {
    expect(agentMood(null, inProgress, "active")).toBe("thinking")
    expect(agentMood("review", inProgress, "active")).toBe("thinking")
  })

  it("looks happy and keeps still once the work is merged", () => {
    expect(agentMood("merged", inProgress, "active")).toBe("merged")
  })

  it("keeps still while the session is quiet or has ended, whatever the stage", () => {
    for (const stage of [null, "building", "review", "fixing", "merged"]) {
      expect(agentMood(stage, inProgress, "idle")).toBe("still")
      expect(agentMood(stage, inProgress, "ended")).toBe("still")
    }
  })

  it("waits for Lucas while the task is in Needs input, its own status or one a workspace named so, even when the agent has gone quiet", () => {
    for (const presence of ["active", "idle", "ended"] as const) {
      expect(agentMood("fixing", needsInput, presence)).toBe("waiting")
      expect(agentMood(null, { name: "needs input", category: "started" }, presence)).toBe("waiting")
    }
  })

  it("is done once the task is In Review or Done, whatever the agent is up to", () => {
    for (const presence of ["active", "idle", "ended"] as const) {
      expect(agentMood(null, inReview, presence)).toBe("done")
      expect(agentMood(null, done, presence)).toBe("done")
    }
  })

  it("keeps still on a canceled task, and on one whose status the board doesn't have", () => {
    expect(agentMood("building", { name: "Canceled", category: "canceled" }, "active")).toBe("still")
    expect(agentMood("building", undefined, "active")).toBe("still")
  })
})

describe("markEntry (CEL-69)", () => {
  const at = (mood: MarkSeen["mood"], statusId: string, checkIn: number | null = 100): MarkSeen => ({ mood, statusId, checkIn })

  it("plays Done when the card moves into In Review or Done while it's on screen, and again from In Review to Done", () => {
    expect(markEntry(at("working", "prog"), at("done", "review"))).toBe("done")
    expect(markEntry(at("still", "prog"), at("done", "done", null))).toBe("done")
    expect(markEntry(at("done", "review"), at("done", "done"))).toBe("done")
  })

  it("hops when the task arrives in Needs input", () => {
    expect(markEntry(at("thinking", "prog"), at("waiting", "needs"))).toBe("waiting")
  })

  it("bursts when the agent starts working or thinking, and again at each check-in while it does: a busy agent keeps moving", () => {
    expect(markEntry(at("still", "prog"), at("working", "prog"))).toBe("burst")
    expect(markEntry(at("thinking", "prog"), at("working", "prog"))).toBe("burst")
    expect(markEntry(at("working", "prog"), at("thinking", "prog"))).toBe("burst")
    expect(markEntry(at("waiting", "needs"), at("thinking", "prog"))).toBe("burst")
    expect(markEntry(at("working", "prog", 100), at("working", "prog", 160))).toBe("burst")
    expect(markEntry(at("thinking", "prog", 100), at("thinking", "prog", 160))).toBe("burst")
  })

  it("plays nothing when nothing arrived: the same mood, status and check-in, going still, a check-in while it waits or rests", () => {
    expect(markEntry(at("working", "prog"), at("working", "prog"))).toBeNull()
    expect(markEntry(at("done", "review"), at("done", "review"))).toBeNull()
    expect(markEntry(at("waiting", "needs"), at("waiting", "needs"))).toBeNull()
    expect(markEntry(at("working", "prog"), at("still", "prog"))).toBeNull()
    expect(markEntry(at("waiting", "needs", 100), at("waiting", "needs", 160))).toBeNull()
    expect(markEntry(at("done", "review", 100), at("done", "review", 160))).toBeNull()
    expect(markEntry(at("merged", "prog", 100), at("merged", "prog", 160))).toBeNull()
  })
})

// CEL-55: subagents work under the orchestrator's session; the board names the agent, the session is its parent.
describe("subagents", () => {
  const orchestrator = session("2fd0505c")
  const held = (id: string, extra: Partial<Task> = {}) => task(id, { assigneeActorId: "claude", assigneeSessionId: "2fd0505c", ...extra })

  it("a card names the agent working on it, with its session as the parent, instead of the orchestrator", () => {
    const t = held("t1")
    const builder = agent("2fd0505c", "a13bfb89c0de1234", { taskId: "t1" })
    const p = provenanceOf(board([t], [orchestrator], [builder]), t, now)
    expect(p.holder?.who).toMatchObject({ name: "cello-builder · a13bfb89", short: "cello-builder · a13bfb89", parent: "Claude Code session 2fd0505c" })
    expect(p.holder?.agent?.agentId).toBe("a13bfb89c0de1234")
    expect(p.holder?.session?.id).toBe("2fd0505c")
  })

  it("the freshest active agent on the task wins; once none is active, the holder session is back", () => {
    const t = held("t1")
    const reviewer = agent("2fd0505c", "b77d0e11", { agentType: "cello-code-reviewer", taskId: "t1", lastSeenAt: now - 10_000 })
    const builder = agent("2fd0505c", "a13bfb89", { taskId: "t1", lastSeenAt: now - 3 * MIN })
    expect(provenanceOf(board([t], [orchestrator], [builder, reviewer]), t, now).holder?.who.name).toBe("cello-code-reviewer · b77d0e11")
    const done = [{ ...builder, endedAt: now - MIN }, { ...reviewer, lastSeenAt: now - 20 * MIN }]
    const p = provenanceOf(board([t], [orchestrator], done), t, now)
    expect(p.holder).toMatchObject({ who: { name: "Claude Code session 2fd0505c" }, agent: null })
  })

  it("a change or comment by an agent names it; an agent the board doesn't know yet still says agent and its session", () => {
    const changed = task("t", { version: 3, updatedByActorId: "claude", updatedBySessionId: "2fd0505c", updatedByAgentId: "a13bfb89", updatedAt: now - 4 * MIN })
    const state = board([changed], [orchestrator], [agent("2fd0505c", "a13bfb89")])
    expect(provenanceLine(provenanceOf(state, changed, now), now)).toBe("Lucas created · cello-builder · a13bfb89 changed 4m ago")
    expect(whoOf(board([], [orchestrator]), "claude", "2fd0505c", "ffee0011aa")).toMatchObject({
      name: "agent · ffee0011", parent: "Claude Code session 2fd0505c",
    })
    expect(whoOf(state, "claude", "2fd0505c", null).name).toBe("Claude Code session 2fd0505c")
  })

  it("Agents working counts each working agent, subagents included, and lists them under their session with their task", () => {
    const tasks = [held("t1"), task("t2"), held("t3")]
    const agents = [
      agent("2fd0505c", "a13bfb89", { taskId: "t1" }),
      agent("2fd0505c", "b77d0e11", { agentType: "cello-code-reviewer", taskId: "t2", lastSeenAt: now - 10_000 }),
      agent("2fd0505c", "c0ffee00", { agentType: "Explore", lastSeenAt: now - 2 * MIN }),
      agent("2fd0505c", "deadbeef", { taskId: "t3", endedAt: now - MIN }),
    ]
    const working = workingSessions(board(tasks, [orchestrator], agents), "w1", now)
    expect(working).toHaveLength(1)
    expect(working[0]!.agents.map((a) => [a.who.name, a.presence, a.task?.id ?? null])).toEqual([
      ["cello-code-reviewer · b77d0e11", "active", "t2"],
      ["cello-builder · a13bfb89", "active", "t1"],
      ["Explore · c0ffee00", "active", null],
    ])
    // The orchestrator and its three working subagents.
    expect(agentsWorkingCount(working)).toBe(4)
  })

  it("a session with an agent on a task in the workspace is listed even when it holds no claim", () => {
    const state = board([task("t2")], [orchestrator], [agent("2fd0505c", "b77d0e11", { taskId: "t2" })])
    expect(workingSessions(state, "w1", now).map((w) => [w.session.id, w.tasks.length, w.agents.length])).toEqual([["2fd0505c", 0, 1]])
  })

  it("the agents of an ended session are ended too: not listed, not counted", () => {
    const state = board([held("t1")], [session("2fd0505c", { endedAt: now - MIN })], [agent("2fd0505c", "a13bfb89", { taskId: "t1" })])
    const working = workingSessions(state, "w1", now)
    expect(working[0]?.agents).toEqual([])
    expect(agentsWorkingCount(working)).toBe(0)
  })
})
