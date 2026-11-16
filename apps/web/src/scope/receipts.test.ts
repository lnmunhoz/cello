// CEL-76 scope: the pure part of delivery receipts on comments and who will get the next one.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, Comment, SessionAgent, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { activityStyle, durationShort, reachOf, reachWords, receiptOf, receiptStyle } from "./receipts.ts"

const MIN = 60_000
const now = Date.UTC(2026, 10, 16, 12)

const session = (id: string, extra: Partial<AgentSession> = {}): AgentSession => ({
  id, actorId: "claude", externalId: id, clientName: "Claude Code", entrypoint: "cli", cwd: "/repo", pid: 1,
  startedAt: now - 60 * MIN, lastSeenAt: now - MIN, endedAt: null, ...extra,
})

const task = (extra: Partial<Task> = {}): Task => ({
  id: "t1", projectId: "p1", number: 1, key: "CEL-1", title: "t", description: "", statusId: "prog", priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: "claude", assigneeSessionId: "s1", createdByActorId: "lucas",
  createdBySessionId: null, updatedByActorId: "lucas", updatedBySessionId: null, stage: "building", commentCount: 0, lastCommentAt: null,
  version: 1, createdAt: now - 90 * MIN, updatedAt: now - 90 * MIN, archivedAt: null, ...extra,
})

const builder = (extra: Partial<SessionAgent> = {}): SessionAgent => ({
  sessionId: "s1", agentId: "a13bfb89aa", agentType: "cello-builder", taskId: "t1", description: null,
  startedAt: now - 30 * MIN, lastSeenAt: now - MIN, endedAt: null, ...extra,
})

const board = (tasks: Task[], sessions: AgentSession[], agents: SessionAgent[] = []): BoardState => ({
  seq: 1,
  actors: {
    lucas: { id: "lucas", kind: "human", name: "Lucas N. Munhoz", client: null, color: "#5e6ad2", createdAt: 1 },
    claude: { id: "claude", kind: "agent", name: "Claude Code", client: "Claude Code", color: "#10b981", createdAt: 1 },
  },
  workspaces: {},
  projects: {},
  statuses: {},
  labels: {},
  tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
  sessions: Object.fromEntries(sessions.map((s) => [s.id, s])),
  agents: Object.fromEntries(agents.map((a) => [`${a.sessionId}/${a.agentId}`, a])),
  reviews: {},
  asks: {},
  documents: {},
})

const comment = (id: string, at: number, extra: Partial<Comment> = {}): Comment => ({
  id, taskId: "t1", body: id, actorId: "lucas", sessionId: null, createdAt: at, updatedAt: at, deletedAt: null, ...extra,
})

describe("the ?receipts and ?activity switches", () => {
  it("reads a, b or c, and sweep or edge; anything else is off", () => {
    expect(receiptStyle("?receipts=b")).toBe("b")
    expect(receiptStyle("?receipts=z")).toBeNull()
    expect(receiptStyle("")).toBeNull()
    expect(activityStyle("?receipts=a&activity=edge")).toBe("edge")
    expect(activityStyle("?activity=loop")).toBeNull()
  })
})

describe("durationShort", () => {
  it("says seconds, minutes or hours, and under a second as such (a waiter takes it at once)", () => {
    expect(durationShort(240)).toBe("<1s")
    expect(durationShort(12_400)).toBe("12s")
    expect(durationShort(3 * MIN + 5_000)).toBe("3m")
    expect(durationShort(125 * MIN)).toBe("2h")
  })
})

describe("receiptOf", () => {
  const state = board([task()], [session("s1")], [builder()])

  it("an agent's own comment has no receipt", () => {
    const own = comment("c", now - MIN, { actorId: "claude", sessionId: "s1" })
    expect(receiptOf(own, [own], [], state)).toBeNull()
  })

  it("a comment that went to nobody (no claim holder) says so", () => {
    const c = comment("c", now - MIN)
    expect(receiptOf(c, [c], [], state)).toEqual({ state: "unsent" })
  })

  it("sent while the session hasn't taken it, delivered with how long it took once it has", () => {
    const c = comment("c", now - MIN)
    const sent = receiptOf(c, [c], [{ commentId: "c", sessionId: "s1", readAt: null }], state)
    expect(sent).toMatchObject({ state: "sent", to: { short: "s1" } })
    const delivered = receiptOf(c, [c], [{ commentId: "c", sessionId: "s1", readAt: now - MIN + 12_000 }], state)
    expect(delivered).toMatchObject({ state: "delivered", to: { short: "s1" }, after: 12_000 })
  })

  it("answered once the session (or one of its subagents) comments after it, even before a delivery was seen", () => {
    const c = comment("c", now - 5 * MIN)
    const reply = comment("r", now - 2 * MIN, { actorId: "claude", sessionId: "s1", agentId: "a13bfb89aa" })
    const other = comment("o", now - 3 * MIN, { actorId: "claude", sessionId: "s9" })
    const answered = receiptOf(c, [c, other, reply], [{ commentId: "c", sessionId: "s1", readAt: null }], state)
    expect(answered).toMatchObject({ state: "answered", by: { short: "cello-builder · a13bfb89" }, after: 3 * MIN })
  })
})

describe("reachOf and reachWords: who gets the next comment", () => {
  it("nobody, when no agent holds the task", () => {
    const free = task({ assigneeActorId: null, assigneeSessionId: null })
    const reach = reachOf(board([free], []), free, new Set(), now)
    expect(reach).toEqual({ kind: "nobody" })
    expect(reachWords(reach, now)).toEqual({ tone: "warn", text: "No agent holds this task, so nobody will get this comment." })
  })

  it("working: the session gets it at its next step; with a subagent on it, the subagent is named too", () => {
    const state = board([task()], [session("s1")], [builder()])
    expect(reachWords(reachOf(state, task(), new Set(), now), now).text).toBe(
      "cello-builder · a13bfb89 is working on it now. s1 gets your comment at its next step.",
    )
    const alone = board([task()], [session("s1")])
    expect(reachWords(reachOf(alone, task(), new Set(), now), now)).toEqual({ tone: "ok", text: "s1 is working on it now and gets your comment at its next step." })
  })

  it("idle with a waiter: it wakes on the comment", () => {
    const state = board([task()], [session("s1", { lastSeenAt: now - 20 * MIN })])
    expect(reachWords(reachOf(state, task(), new Set(["s1"]), now), now)).toEqual({ tone: "ok", text: "s1 is waiting for you: your comment wakes it." })
  })

  it("idle with no waiter: it gets it when it next works", () => {
    const state = board([task()], [session("s1", { lastSeenAt: now - 20 * MIN })])
    expect(reachWords(reachOf(state, task(), new Set(), now), now)).toEqual({
      tone: "idle",
      text: "s1 is idle (seen 20m ago) and isn't waiting: it gets this when it next works.",
    })
  })

  it("ended: nobody gets it unless the session resumes", () => {
    const state = board([task()], [session("s1", { endedAt: now - 10 * MIN })])
    expect(reachWords(reachOf(state, task(), new Set(["s1"]), now), now)).toEqual({
      tone: "warn",
      text: "s1 has ended, so nobody will get this unless it resumes.",
    })
  })
})
