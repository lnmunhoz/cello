import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { provenanceLine, provenanceOf, workingSessions } from "./model.ts"

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
