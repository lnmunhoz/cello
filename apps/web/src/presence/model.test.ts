import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, SessionAgent, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { agentMood, agentsWorkingCount, authorParts, holderActive, markEntry, stepOf, type MarkSeen, provenanceLine, provenanceOf, whoOf, whoSubject, whoText, workingSessions } from "./model.ts"

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

const STATUSES = {
  prog: { id: "prog", workspaceId: "w1", name: "In Progress", category: "started", position: "a1", color: "#f59e0b", hidden: false, createdAt: 1, updatedAt: 1 },
  needs: { id: "needs", workspaceId: "w1", name: "Needs input", category: "waiting", position: "a2", color: "#f97316", hidden: false, createdAt: 1, updatedAt: 1 },
  review: { id: "review", workspaceId: "w1", name: "In Review", category: "started", position: "a3", color: "#8b5cf6", hidden: false, createdAt: 1, updatedAt: 1 },
} as const

const board = (tasks: Task[], sessions: AgentSession[], agents: SessionAgent[] = []): BoardState => ({
  seq: 1,
  actors: {
    lucas: { id: "lucas", kind: "human", name: "Lucas N. Munhoz", client: null, color: "#5e6ad2", createdAt: 1 },
    claude: { id: "claude", kind: "agent", name: "Claude Code", client: "Claude Code", color: "#10b981", createdAt: 1 },
  },
  workspaces: {},
  projects: { p1: { id: "p1", workspaceId: "w1", name: "Cello", key: "CEL", color: "#000", description: "", repoPath: null, mergeAfterApproval: false, createdAt: 1, updatedAt: 1, archivedAt: null } },
  statuses: STATUSES,
  labels: {},
  tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
  sessions: Object.fromEntries(sessions.map((s) => [s.id, s])),
  agents: Object.fromEntries(agents.map((a) => [`${a.sessionId}/${a.agentId}`, a])),
  reviews: {},
  asks: {},
  documents: {}, wakes: {}, testOutcomes: {}, milestones: {},
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

describe("holderActive (CEL-105)", () => {
  it("is true while the agent session holding the claim is active", () => {
    const held = task("t", { assigneeActorId: "claude", assigneeSessionId: "8a41c9e2" })
    expect(holderActive(board([held], [session("8a41c9e2")]), held, now)).toBe(true)
  })

  it("is false once the session is quiet or has ended", () => {
    const held = task("t", { assigneeActorId: "claude", assigneeSessionId: "8a41c9e2" })
    expect(holderActive(board([held], [session("8a41c9e2", { lastSeenAt: now - 20 * MIN })]), held, now)).toBe(false)
    expect(holderActive(board([held], [session("8a41c9e2", { endedAt: now - MIN })]), held, now)).toBe(false)
  })

  it("is true while a subagent works on it, even when the holding session is quiet", () => {
    const held = task("t", { assigneeActorId: "claude", assigneeSessionId: "2fd0505c" })
    const state = board([held], [session("2fd0505c", { lastSeenAt: now - 20 * MIN })], [agent("2fd0505c", "a13bfb89", { taskId: "t" })])
    expect(holderActive(state, held, now)).toBe(true)
  })

  it("is false for a task Lucas holds, and for one nobody holds", () => {
    expect(holderActive(board([], []), task("t", { assigneeActorId: "lucas" }), now)).toBe(false)
    expect(holderActive(board([], []), task("u"), now)).toBe(false)
  })
})

describe("stepOf: the step a card, row or panel shows (CEL-105)", () => {
  it("the stage when it has one", () => {
    const held = task("t", { assigneeActorId: "claude", assigneeSessionId: "8a41c9e2", stage: "planning" })
    expect(stepOf(board([held], [session("8a41c9e2")]), held, now)?.label).toBe("Planning")
  })

  it("Working with no stage while its agent is active, and nothing once the agent is quiet or ended", () => {
    const held = task("t", { assigneeActorId: "claude", assigneeSessionId: "8a41c9e2" })
    expect(stepOf(board([held], [session("8a41c9e2")]), held, now)).toMatchObject({ id: "working", label: "Working" })
    expect(stepOf(board([held], [session("8a41c9e2", { lastSeenAt: now - 20 * MIN })]), held, now)).toBeNull()
    expect(stepOf(board([held], [session("8a41c9e2", { endedAt: now - MIN })]), held, now)).toBeNull()
  })

  it("Working only in In Progress: a task waiting in Needs input (its session active, running --wait) isn't Working; a stage still shows there", () => {
    const waiting = task("t", { assigneeActorId: "claude", assigneeSessionId: "8a41c9e2", statusId: "needs" })
    expect(stepOf(board([waiting], [session("8a41c9e2")]), waiting, now)).toBeNull()
    const staged = { ...waiting, stage: "building" as const }
    expect(stepOf(board([staged], [session("8a41c9e2")]), staged, now)?.label).toBe("Building")
    const inReview = { ...waiting, statusId: "review" }
    expect(stepOf(board([inReview], [session("8a41c9e2")]), inReview, now)).toBeNull()
  })

  it("provenanceOf carries it, next to the stage itself", () => {
    const held = task("t", { assigneeActorId: "claude", assigneeSessionId: "8a41c9e2" })
    const p = provenanceOf(board([held], [session("8a41c9e2")]), held, now)
    expect(p.stage).toBeNull()
    expect(p.step?.label).toBe("Working")
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

  // CEL-143: approved in a project that merges after approval, the task waits in In Review while its agent
  // merges it: not done yet.
  it("works while an active agent merges an approved task (Approved · merging), and keeps still while it's quiet", () => {
    expect(agentMood("merging", inReview, "active")).toBe("working")
    expect(agentMood("fixing", inReview, "active")).toBe("working")
    expect(agentMood("merged", inReview, "active")).toBe("merged")
    expect(agentMood("merging", inReview, "idle")).toBe("still")
  })

  it("keeps still on a canceled task, and on one whose status the board doesn't have", () => {
    expect(agentMood("building", { name: "Canceled", category: "canceled" }, "active")).toBe("still")
    expect(agentMood("building", undefined, "active")).toBe("still")
  })
})

describe("markEntry (CEL-69)", () => {
  const at = (mood: MarkSeen["mood"], statusId: string): MarkSeen => ({ mood, statusId })

  it("plays Done when the card moves into In Review or Done while it's on screen, and again from In Review to Done", () => {
    expect(markEntry(at("working", "prog"), at("done", "review"))).toBe("done")
    expect(markEntry(at("still", "prog"), at("done", "done"))).toBe("done")
    expect(markEntry(at("done", "review"), at("done", "done"))).toBe("done")
  })

  it("hops when the task arrives in Needs input", () => {
    expect(markEntry(at("thinking", "prog"), at("waiting", "needs"))).toBe("waiting")
  })

  it("has no entry for working or thinking: those loop by their mood, while the agent is active", () => {
    expect(markEntry(at("still", "prog"), at("working", "prog"))).toBeNull()
    expect(markEntry(at("thinking", "prog"), at("working", "prog"))).toBeNull()
    expect(markEntry(at("waiting", "needs"), at("thinking", "prog"))).toBeNull()
  })

  it("plays nothing when nothing arrived: the same mood and status, going still", () => {
    expect(markEntry(at("done", "review"), at("done", "review"))).toBeNull()
    expect(markEntry(at("waiting", "needs"), at("waiting", "needs"))).toBeNull()
    expect(markEntry(at("working", "prog"), at("still", "prog"))).toBeNull()
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

// CEL-55 + CEL-69: the sidebar's entries show the same mark as the cards, in the same mood.
describe("Agents working: each entry's mark", () => {
  const statuses = {
    prog: { id: "prog", workspaceId: "w1", name: "In Progress", category: "started", position: "a1", color: "#f59e0b", hidden: false, createdAt: 1, updatedAt: 1 },
    needs: { id: "needs", workspaceId: "w1", name: "Needs input", category: "waiting", position: "a2", color: "#f97316", hidden: false, createdAt: 1, updatedAt: 1 },
    review: { id: "review", workspaceId: "w1", name: "In Review", category: "started", position: "a3", color: "#8b5cf6", hidden: false, createdAt: 1, updatedAt: 1 },
  } as const
  const withStatuses = (state: BoardState): BoardState => ({ ...state, statuses })
  const orchestrator = session("2fd0505c")
  const held = (id: string, extra: Partial<Task> = {}) => task(id, { assigneeActorId: "claude", assigneeSessionId: "2fd0505c", ...extra })
  const marks = (state: BoardState) => {
    const [w] = workingSessions(withStatuses(state), "w1", now)
    return { session: w!.mark, agents: Object.fromEntries(w!.agents.map((a) => [a.agent.agentId, a.mark])) }
  }

  it("a subagent's entry has its task's card mood and status: working while it builds, waiting in Needs input, done in review", () => {
    const tasks = [held("t1", { stage: "building" }), held("t2", { statusId: "needs" }), held("t3", { statusId: "review" })]
    const agents = [
      agent("2fd0505c", "a13bfb89", { taskId: "t1" }),
      agent("2fd0505c", "b77d0e11", { taskId: "t2", lastSeenAt: now - 2 * MIN }),
      agent("2fd0505c", "c0ffee00", { taskId: "t3", lastSeenAt: now - 3 * MIN }),
    ]
    expect(marks(board(tasks, [orchestrator], agents)).agents).toEqual({
      a13bfb89: { mood: "working", statusId: "prog" },
      b77d0e11: { mood: "waiting", statusId: "needs" },
      c0ffee00: { mood: "done", statusId: "review" },
    })
  })

  it("an entry with no task thinks while it's active and keeps still once quiet", () => {
    const agents = [agent("2fd0505c", "a13bfb89", { taskId: "t1" }), agent("2fd0505c", "c0ffee00", { agentType: "Explore" }), agent("2fd0505c", "deadbeef", { lastSeenAt: now - 20 * MIN })]
    const { agents: m } = marks(board([held("t1", { stage: "building" })], [orchestrator], agents))
    expect(m.c0ffee00).toEqual({ mood: "thinking", statusId: "" })
    expect(m.deadbeef).toEqual({ mood: "still", statusId: "" })
  })

  it("a session's entry reads the tasks its own cards show, Needs input first; with a subagent on each, it orchestrates (thinking)", () => {
    const tasks = [held("t1", { stage: "building" }), held("t2", { statusId: "needs" }), held("t3", { stage: "review" })]
    expect(marks(board(tasks, [orchestrator])).session).toEqual({ mood: "waiting", statusId: "needs" })
    expect(marks(board([tasks[0]!, tasks[2]!], [orchestrator])).session).toEqual({ mood: "working", statusId: "prog" })
    // A builder on the building task: the session's card is the one in Agent review.
    expect(marks(board([tasks[0]!, tasks[2]!], [orchestrator], [agent("2fd0505c", "a13bfb89", { taskId: "t1" })])).session).toEqual({ mood: "thinking", statusId: "prog" })
    const everyTask = [agent("2fd0505c", "a13bfb89", { taskId: "t1" }), agent("2fd0505c", "b77d0e11", { taskId: "t3" })]
    expect(marks(board([tasks[0]!, tasks[2]!], [orchestrator], everyTask)).session).toEqual({ mood: "thinking", statusId: "" })
  })

  it("a quiet session keeps still, unless a task of its waits on Lucas", () => {
    const quiet = session("2fd0505c", { lastSeenAt: now - 20 * MIN })
    expect(marks(board([held("t1", { stage: "building" })], [quiet])).session).toEqual({ mood: "still", statusId: "prog" })
    expect(marks(board([held("t1", { statusId: "needs" })], [quiet])).session).toEqual({ mood: "waiting", statusId: "needs" })
  })
})

// CEL-119: who wrote it (the main session, or a subagent of it) and the model and effort that wrote it.
describe("an author's role and model", () => {
  const orchestrator = session("2fd0505c", { model: "claude-opus-5-5", effort: "high" })
  const builder = agent("2fd0505c", "a13bfb89c0de1234", { model: "claude-sonnet-5-5", effort: "medium" })
  const state = board([], [orchestrator], [builder])

  it("a comment from the main session: name, Main session, its model and effort, then the session id", () => {
    const who = whoOf(state, "claude", "2fd0505c", null, { model: "claude-opus-5-5", effort: "high" })
    expect(authorParts(who)).toEqual([
      { kind: "name", text: "Claude Code" },
      { kind: "role", text: "Main session" },
      { kind: "model", text: "Opus 5.5" },
      { kind: "effort", text: "high" },
      { kind: "session", text: "2fd0505c", title: "Claude Code session 2fd0505c" },
    ])
    expect(whoText(who)).toBe("Claude Code (Opus 5.5), main session 2fd0505c")
    expect(whoSubject(who)).toEqual({ subject: "Claude Code (Opus 5.5), main session 2fd0505c,", plain: "Claude Code session 2fd0505c" })
  })

  it("a comment from a subagent: its type, Subagent of its session, its own model and effort", () => {
    const who = whoOf(state, "claude", "2fd0505c", "a13bfb89c0de1234", { model: "claude-sonnet-5-5", effort: "medium" })
    expect(authorParts(who)).toEqual([
      { kind: "name", text: "cello-builder", title: "cello-builder · a13bfb89" },
      { kind: "role", text: "Subagent of " },
      { kind: "session", text: "2fd0505c", title: "Claude Code session 2fd0505c" },
      { kind: "model", text: "Sonnet 5.5" },
      { kind: "effort", text: "medium" },
    ])
    expect(whoText(who)).toBe("cello-builder (Sonnet 5.5), subagent of 2fd0505c")
    // As the subject of a history line, the aside closes with a comma; its plain name is for possessives.
    expect(whoSubject(who)).toEqual({ subject: "cello-builder (Sonnet 5.5), subagent of 2fd0505c,", plain: "cello-builder · a13bfb89" })
  })

  it("keeps the model it was written with: never the session's current one, and none when it wasn't known", () => {
    const old = whoOf(state, "claude", "2fd0505c", null, { model: "claude-haiku-5-5", effort: null })
    expect(authorParts(old).filter((p) => p.kind === "model" || p.kind === "effort")).toEqual([{ kind: "model", text: "Haiku 5.5" }])
    const unknown = whoOf(state, "claude", "2fd0505c", "a13bfb89c0de1234", {})
    expect(authorParts(unknown).map((p) => p.kind)).toEqual(["name", "role", "session"])
    expect(whoText(unknown)).toBe("cello-builder, subagent of 2fd0505c")
    // Without what it was written with (the task's "Created by"), no model either.
    expect(whoOf(state, "claude", "2fd0505c", null).model ?? null).toBeNull()
  })

  it("an id the app doesn't know shows as it is", () => {
    const who = whoOf(state, "claude", "2fd0505c", null, { model: "claude-foo-6", effort: "max" })
    expect(whoText(who)).toBe("Claude Code (claude-foo-6), main session 2fd0505c")
  })

  it("the human, and an agent whose session the board doesn't have, are named as before", () => {
    const human = whoOf(state, "lucas", null, null, { model: null, effort: null })
    expect(authorParts(human)).toEqual([{ kind: "name", text: "Lucas N. Munhoz" }])
    expect(whoText(human)).toBe("Lucas N. Munhoz")
    expect(whoSubject(human)).toEqual({ subject: "Lucas N. Munhoz", plain: "Lucas N. Munhoz" })
    expect(whoText(whoOf(state, "claude", "gone", null, { model: "claude-opus-5-5" }))).toBe("Claude Code")
  })

  it("presence and the Agents page show each agent's current model", () => {
    const holds = task("t1", { assigneeActorId: "claude", assigneeSessionId: "2fd0505c" })
    const working = workingSessions(board([holds], [orchestrator], [{ ...builder, taskId: "t1" }]), "w1", now)[0]!
    expect([working.who.role, working.who.model, working.who.effort]).toEqual(["main", "claude-opus-5-5", "high"])
    expect([working.agents[0]!.who.role, working.agents[0]!.who.model]).toEqual(["subagent", "claude-sonnet-5-5"])
  })
})
