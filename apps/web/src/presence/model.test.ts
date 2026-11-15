import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { agentMood, markEntry, provenanceLine, provenanceOf, workingSessions } from "./model.ts"

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

const board = (tasks: Task[], sessions: AgentSession[]): BoardState => ({
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
  it("plays Done when the card moves into In Review or Done while it's on screen, and again from In Review to Done", () => {
    expect(markEntry({ mood: "working", statusId: "prog" }, { mood: "done", statusId: "review" })).toBe("done")
    expect(markEntry({ mood: "still", statusId: "prog" }, { mood: "done", statusId: "done" })).toBe("done")
    expect(markEntry({ mood: "done", statusId: "review" }, { mood: "done", statusId: "done" })).toBe("done")
  })

  it("hops when the task arrives in Needs input", () => {
    expect(markEntry({ mood: "thinking", statusId: "prog" }, { mood: "waiting", statusId: "needs" })).toBe("waiting")
  })

  it("plays nothing when nothing arrived: the same mood and status, a loop starting or stopping, a stage changing", () => {
    expect(markEntry({ mood: "done", statusId: "review" }, { mood: "done", statusId: "review" })).toBeNull()
    expect(markEntry({ mood: "waiting", statusId: "needs" }, { mood: "waiting", statusId: "needs" })).toBeNull()
    expect(markEntry({ mood: "thinking", statusId: "prog" }, { mood: "working", statusId: "prog" })).toBeNull()
    expect(markEntry({ mood: "working", statusId: "prog" }, { mood: "still", statusId: "prog" })).toBeNull()
    expect(markEntry({ mood: "waiting", statusId: "needs" }, { mood: "thinking", statusId: "prog" })).toBeNull()
  })
})
