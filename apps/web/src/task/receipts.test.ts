// CEL-76: delivery receipts on Lucas's comments, and who gets the next one.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, Comment, Reaction, SessionAgent, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { durationShort, pendingWords, reachOf, reachWords, receiptOf, receiptTitle } from "./receipts.ts"

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
const sentTo = (sessionId: string, readAt: number | null = null, via: "hook" | "inbox" | "wait" | null = null) => ({
  delivery: { sessionId, readAt, via },
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
    const own = comment("c", now - MIN, { actorId: "claude", sessionId: "s1", delivery: null })
    expect(receiptOf(own, [own], state)).toBeNull()
  })

  it("a comment that went to nobody (no claim holder) is unsent", () => {
    const c = comment("c", now - MIN, { delivery: null })
    expect(receiptOf(c, [c], state)).toEqual({ state: "unsent" })
    expect(receiptTitle({ state: "unsent" })).toBe("No agent held this task when you wrote it, so nobody got it")
  })

  it("sent while the session hasn't taken it; delivered with how long it took and how, once it has", () => {
    const sent = comment("c", now - MIN, sentTo("s1"))
    expect(receiptOf(sent, [sent], state)).toMatchObject({ state: "sent", to: { short: "s1" } })
    const taken = comment("c", now - MIN, sentTo("s1", now - MIN + 12_000, "hook"))
    const delivered = receiptOf(taken, [taken], state)!
    expect(delivered).toMatchObject({ state: "delivered", to: { short: "s1" }, after: 12_000, via: "hook" })
    expect(receiptTitle(delivered)).toBe("Claude Code session s1 took it 12s after you sent it, through its hook")
  })

  it("answered once the session or one of its subagents comments after it, even before the delivery shows", () => {
    const c = comment("c", now - 5 * MIN, sentTo("s1"))
    const reply = comment("r", now - 2 * MIN, { actorId: "claude", sessionId: "s1", agentId: "a13bfb89aa" })
    const other = comment("o", now - 3 * MIN, { actorId: "claude", sessionId: "s9" })
    const before = comment("b", now - 6 * MIN, { actorId: "claude", sessionId: "s1" })
    expect(receiptOf(c, [before, c, other, reply], state)).toMatchObject({ state: "answered", by: { short: "cello-builder · a13bfb89" }, after: 3 * MIN })
  })

  it("answered by a reaction from that session (CEL-77); Lucas's own reaction or another session's doesn't count", () => {
    const reaction = (id: string, sessionId: string | null, at: number): Reaction => ({
      id, commentId: "c", taskId: "t1", emoji: "👍", actorId: sessionId ? "claude" : "lucas", sessionId, createdAt: at,
    })
    const mine = comment("c", now - 5 * MIN, { ...sentTo("s1", now - 4 * MIN, "hook"), reactions: [reaction("x", null, now - 4 * MIN), reaction("y", "s9", now - 4 * MIN)] })
    expect(receiptOf(mine, [mine], state)).toMatchObject({ state: "delivered" })
    const thumbs = { ...mine, reactions: [...mine.reactions!, reaction("z", "s1", now - 3 * MIN)] }
    const answered = receiptOf(thumbs, [thumbs], state)!
    expect(answered).toMatchObject({ state: "answered", emoji: "👍", after: 2 * MIN })
    expect(receiptTitle(answered)).toBe("Claude Code session s1 reacted 👍 2m after you sent it")
  })
})

describe("reachOf, reachWords and pendingWords: who gets the next comment", () => {
  it("nobody, when no agent holds the task", () => {
    const free = task({ assigneeActorId: null, assigneeSessionId: null })
    const reach = reachOf(board([free], []), free, now)
    expect(reach).toEqual({ kind: "nobody" })
    expect(reachWords(reach, now)).toEqual({ tone: "warn", text: "No agent holds this task, so nobody will get this comment." })
    expect(pendingWords(reach)).toBe("nobody holds the task now")
  })

  it("active: the session gets it at its next step; with a subagent on it, the subagent is named too (CEL-55)", () => {
    const alone = reachOf(board([task()], [session("s1")]), task(), now)
    expect(reachWords(alone, now)).toEqual({ tone: "ok", text: "s1 is active now and gets your comment at its next step." })
    expect(pendingWords(alone)).toBe("s1 gets it at its next step")
    const withBuilder = reachOf(board([task()], [session("s1")], [builder()]), task(), now)
    expect(reachWords(withBuilder, now).text).toBe("cello-builder · a13bfb89 is working on it now. s1 gets your comment at its next step.")
  })

  it("waiting: a `cello inbox --wait` is open, so it gets the comment in about a second", () => {
    const reach = reachOf(board([task()], [session("s1", { lastSeenAt: now - 20 * MIN, waiting: true })]), task(), now)
    expect(reachWords(reach, now)).toEqual({ tone: "ok", text: "s1 is waiting for you: it gets your comment in about a second." })
    expect(pendingWords(reach)).toBe("s1 gets it in about a second")
  })

  it("idle with no waiter: it gets it when it next works", () => {
    const reach = reachOf(board([task()], [session("s1", { lastSeenAt: now - 20 * MIN })]), task(), now)
    expect(reachWords(reach, now)).toEqual({ tone: "idle", text: "s1 is idle (seen 20m ago) and isn't waiting: it gets this when it next works." })
    expect(pendingWords(reach)).toBe("s1 is idle, gets it when it next works")
  })

  it("ended: nobody gets it unless the session resumes, even with a waiter left over", () => {
    const reach = reachOf(board([task()], [session("s1", { endedAt: now - 10 * MIN, waiting: true })]), task(), now)
    expect(reachWords(reach, now)).toEqual({ tone: "warn", text: "s1 has ended, so nobody will get this unless it resumes." })
    expect(pendingWords(reach)).toBe("s1 has ended")
  })
})
