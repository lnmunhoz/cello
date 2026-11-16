import type { AgentSession, SessionAgent, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { finishedAgents, startOfDay, workingAgents } from "./agents.ts"
import type { BoardState } from "./applyEvents.ts"

const MIN = 60_000
const now = new Date(2026, 10, 16, 15, 0).getTime()
const today = startOfDay(now)

const session = (id: string, extra: Partial<AgentSession> = {}): AgentSession => ({
  id, actorId: "claude", externalId: `${id}-417a-4167`, clientName: "Claude Code", entrypoint: "cli", cwd: "/repo", pid: 1,
  startedAt: now - 60 * MIN, lastSeenAt: now - MIN, endedAt: null, ...extra,
})

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number: 1, key: `CEL-${id}`, title: id, description: "", statusId: "prog", priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "lucas",
  createdBySessionId: null, updatedByActorId: "lucas", updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1,
  createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})

const agent = (sessionId: string, agentId: string, extra: Partial<SessionAgent> = {}): SessionAgent => ({
  sessionId, agentId, agentType: "cello-builder", taskId: null, description: null,
  startedAt: now - 30 * MIN, lastSeenAt: now - MIN, endedAt: null, ...extra,
})

const project = (id: string, workspaceId: string) =>
  ({ id, workspaceId, name: id, key: id.toUpperCase(), color: "#000", description: "", repoPath: null, createdAt: 1, updatedAt: 1, archivedAt: null })

const board = (tasks: Task[], sessions: AgentSession[], agents: SessionAgent[] = []): BoardState => ({
  seq: 1,
  actors: {},
  workspaces: {},
  projects: { p1: project("p1", "w1"), p2: project("p2", "w2") },
  statuses: {},
  labels: {},
  tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
  sessions: Object.fromEntries(sessions.map((s) => [s.id, s])),
  agents: Object.fromEntries(agents.map((a) => [`${a.sessionId}/${a.agentId}`, a])),
  reviews: {},
  asks: {},
  documents: {},
  wakes: {},
})

const held = (id: string, sessionId: string, extra: Partial<Task> = {}) => task(id, { assigneeActorId: "claude", assigneeSessionId: sessionId, ...extra })

describe("workingAgents", () => {
  it("each session working in the workspace, active first, with its tasks and its subagents still working, freshest first", () => {
    const state = board(
      [held("1", "s1"), held("2", "s2"), task("3"), task("9", { projectId: "p2" })],
      [session("s1", { lastSeenAt: now - 20 * MIN }), session("s2")],
      [
        agent("s1", "a1", { taskId: "3", lastSeenAt: now - 3 * MIN }),
        agent("s1", "a2", { agentType: "Explore", lastSeenAt: now - MIN }),
        agent("s1", "a3", { taskId: "3", endedAt: now - MIN }),
        agent("s1", "a4", { taskId: "9" }),
      ],
    )
    expect(workingAgents(state, "w1", now).map((w) => [w.session.id, w.presence, w.tasks.map((t) => t.key), w.agents.map((a) => a.agent.agentId)])).toEqual([
      ["s2", "active", ["CEL-2"], []],
      ["s1", "idle", ["CEL-1"], ["a2", "a1"]],
    ])
  })
})

describe("finishedAgents: Finished today (CEL-107)", () => {
  it("the sessions and subagents of the workspace that ended today, newest first; a subagent that never stopped ends with its session", () => {
    const state = board(
      [held("1", "s1"), task("2"), task("9", { projectId: "p2" })],
      [session("s1", { endedAt: now - 10 * MIN }), session("s2"), session("s3", { endedAt: now - 5 * MIN })],
      [
        // Under the ended s1, never stopped: ends with it.
        agent("s1", "a1", { taskId: "1" }),
        // Of a working session, on a task here: stopped an hour ago.
        agent("s2", "a2", { taskId: "2", endedAt: now - 60 * MIN }),
        // Still working: not finished.
        agent("s2", "a3", { taskId: "2" }),
        // Stopped yesterday.
        agent("s2", "a4", { taskId: "2", endedAt: today - MIN }),
        // On another workspace's task.
        agent("s2", "a5", { taskId: "9", endedAt: now - MIN }),
        // A helper with no task, under s2 (which has a subagent on a task here).
        agent("s2", "a6", { agentType: "Explore", endedAt: now - 2 * MIN }),
      ],
    )
    expect(finishedAgents(state, "w1", today).map((f) => [f.session.id, f.agent?.agentId ?? null, f.endedAt, f.tasks.map((t) => t.key)])).toEqual([
      ["s2", "a6", now - 2 * MIN, []],
      ["s1", null, now - 10 * MIN, ["CEL-1"]],
      ["s1", "a1", now - 10 * MIN, ["CEL-1"]],
      ["s2", "a2", now - 60 * MIN, ["CEL-2"]],
    ])
  })

  it("a session with nothing in the workspace (no claim, no subagent on a task here) isn't listed", () => {
    const state = board([task("9", { projectId: "p2" })], [session("s3", { endedAt: now - MIN })], [agent("s3", "a1", { endedAt: now - MIN })])
    expect(finishedAgents(state, "w1", today)).toEqual([])
  })
})

describe("startOfDay", () => {
  it("local midnight before the time", () => {
    expect(startOfDay(now)).toBe(new Date(2026, 10, 16).getTime())
    expect(startOfDay(new Date(2026, 10, 16).getTime())).toBe(new Date(2026, 10, 16).getTime())
  })
})
