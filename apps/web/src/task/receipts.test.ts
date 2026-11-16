// CEL-76: delivery receipts on Lucas's comments, and who gets the next one.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, Comment, Reaction, SessionAgent, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { commentStatus, durationShort, reachOf, reachWords, receiptOf, receiptTitle, sentWords, statusCommentId, unsentTone } from "./receipts.ts"

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
  documents: {}, wakes: {},
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

  it("answered once the session or one of its subagents comments after taking it", () => {
    const c = comment("c", now - 5 * MIN, sentTo("s1", now - 4 * MIN, "hook"))
    const reply = comment("r", now - 2 * MIN, { actorId: "claude", sessionId: "s1", agentId: "a13bfb89aa" })
    const other = comment("o", now - 3 * MIN, { actorId: "claude", sessionId: "s9" })
    const before = comment("b", now - 6 * MIN, { actorId: "claude", sessionId: "s1" })
    expect(receiptOf(c, [before, c, other, reply], state)).toMatchObject({ state: "answered", by: { short: "cello-builder · a13bfb89" }, after: 3 * MIN })
  })

  it("a reply the session wrote before it took the comment isn't an answer to it: Sent, or Delivered once taken", () => {
    const reply = comment("r", now - 2 * MIN, { actorId: "claude", sessionId: "s1" })
    const untaken = comment("c", now - 5 * MIN, sentTo("s1"))
    expect(receiptOf(untaken, [untaken, reply], state)).toMatchObject({ state: "sent" })
    const takenLater = comment("c", now - 5 * MIN, sentTo("s1", now - MIN, "hook"))
    expect(receiptOf(takenLater, [takenLater, reply], state)).toMatchObject({ state: "delivered" })
  })

  it("answered by a reaction from that session (CEL-77); Lucas's own reaction or another session's doesn't count", () => {
    const reaction = (id: string, sessionId: string | null, at: number): Reaction => ({
      id, commentId: "c", taskId: "t1", emoji: "👍", actorId: sessionId ? "claude" : "lucas", sessionId, createdAt: at,
    })
    const mine = comment("c", now - 5 * MIN, { ...sentTo("s1", now - 4 * MIN, "hook"), reactions: [reaction("x", null, now - 4 * MIN), reaction("y", "s9", now - 4 * MIN)] })
    // A reaction from before it took the comment doesn't answer it either.
    const early = { ...mine, delivery: { sessionId: "s1", readAt: null, via: null }, reactions: [reaction("w", "s1", now - 4 * MIN)] }
    expect(receiptOf(early, [early], state)).toMatchObject({ state: "sent" })
    expect(receiptOf(mine, [mine], state)).toMatchObject({ state: "delivered" })
    const thumbs = { ...mine, reactions: [...mine.reactions!, reaction("z", "s1", now - 3 * MIN)] }
    const answered = receiptOf(thumbs, [thumbs], state)!
    expect(answered).toMatchObject({ state: "answered", emoji: "👍", after: 2 * MIN })
    expect(receiptTitle(answered)).toBe("Claude Code session s1 reacted 👍 2m after you sent it")
  })
})

describe("sentWords: what the Sent tick adds", () => {
  it("nothing while it went to the holder (the status row says how soon), else the inbox it waits in once the claim moved on", () => {
    const sent = (sessionId: string) => ({ state: "sent" as const, to: { kind: "agent" as const, name: "x", short: sessionId, color: "" }, sessionId })
    expect(sentWords(sent("s1"), task())).toBeNull()
    expect(sentWords(sent("s2"), task())).toBe("waiting in s2's inbox; s2 no longer holds this task")
    expect(sentWords(sent("s1"), task({ assigneeActorId: null, assigneeSessionId: null }))).toBe("waiting in s1's inbox; s1 no longer holds this task")
  })
})

describe("unsentTone: Not delivered is a warning only where an agent could have taken it", () => {
  const status = (category: "started" | "completed") => ({
    id: "prog", workspaceId: "w1", name: category === "started" ? "In Progress" : "Done", category, position: "a0", color: "#999", hidden: false,
    createdAt: 1, updatedAt: 1,
  })
  const withStatus = (category: "started" | "completed") => ({ ...board([task()], [session("s1")]), statuses: { prog: status(category) } })
  const free = task({ assigneeActorId: null, assigneeSessionId: null, updatedBySessionId: "s1" })

  it("warns on a task agents work on, while it's open", () => {
    const c = comment("c", now - MIN, { delivery: null })
    expect(unsentTone(c, [c], free, withStatus("started"))).toBe("warn")
  })

  it("quiet on a Done task, a task no agent ever touched, or a comment from before receipts existed", () => {
    const c = comment("c", now - MIN, { delivery: null })
    expect(unsentTone(c, [c], free, withStatus("completed"))).toBe("quiet")
    const untouched = task({ assigneeActorId: null, assigneeSessionId: null })
    expect(unsentTone(c, [c], untouched, withStatus("started"))).toBe("quiet")
    const old = comment("o", Date.UTC(2026, 10, 10), { delivery: null })
    expect(unsentTone(old, [old], free, withStatus("started"))).toBe("quiet")
  })
})

describe("reachOf and reachWords: how soon the holder gets a comment", () => {
  it("nobody, when no agent holds the task", () => {
    const free = task({ assigneeActorId: null, assigneeSessionId: null })
    const reach = reachOf(board([free], []), free, now)
    expect(reach).toEqual({ kind: "nobody" })
    expect(reachWords(reach)).toEqual({ tone: "warn", text: "No agent holds this task: nobody will get this" })
  })

  it("active, or a subagent of it working on the task (CEL-55): the session gets it at its next step", () => {
    const alone = reachOf(board([task()], [session("s1")]), task(), now)
    expect(reachWords(alone)).toEqual({ tone: "ok", text: "s1 gets this at its next step" })
    const withBuilder = reachOf(board([task()], [session("s1", { lastSeenAt: now - 20 * MIN })], [builder()]), task(), now)
    expect(withBuilder).toMatchObject({ presence: "idle", worker: { short: "cello-builder · a13bfb89" } })
    expect(reachWords(withBuilder)).toEqual({ tone: "ok", text: "s1 gets this at its next step" })
  })

  it("waiting: a `cello inbox --wait` is open, so it gets the comment in about a second", () => {
    const reach = reachOf(board([task()], [session("s1", { lastSeenAt: now - 20 * MIN, waiting: true })]), task(), now)
    expect(reachWords(reach)).toEqual({ tone: "ok", text: "s1 is waiting for you: it gets this in about a second" })
  })

  it("idle with no waiter: it gets it when it next works", () => {
    const reach = reachOf(board([task()], [session("s1", { lastSeenAt: now - 20 * MIN })]), task(), now)
    expect(reachWords(reach)).toEqual({ tone: "idle", text: "s1 is idle: it gets this when it next works" })
  })

  it("ended: it gets it only if the session is resumed, even with a waiter left over", () => {
    const reach = reachOf(board([task()], [session("s1", { endedAt: now - 10 * MIN, waiting: true })]), task(), now)
    expect(reachWords(reach)).toEqual({ tone: "idle", text: "s1 ended: it gets this if the session is resumed" })
  })
})

describe("statusCommentId: the status row follows Lucas's latest comment", () => {
  it("his latest, even with agent comments after it; none without one of his", () => {
    const mine = comment("a", now - 5 * MIN)
    const later = comment("b", now - 3 * MIN)
    const agent = comment("r", now - MIN, { actorId: "claude", sessionId: "s1" })
    expect(statusCommentId([mine, later, agent])).toBe("b")
    expect(statusCommentId([agent])).toBeNull()
    expect(statusCommentId([])).toBeNull()
  })
})

describe("commentStatus: what the row under Lucas's latest comment says", () => {
  const status = (c: Comment, state: BoardState, t: Task = task(), thread: Comment[] = [c]) => commentStatus(c, thread, t, state, now)
  const active = board([task()], [session("s1")])

  it("not taken yet: how soon the holder gets it, in the holder's state", () => {
    const sent = comment("c", now - MIN, sentTo("s1"))
    expect(status(sent, active)).toMatchObject({ tone: "ok", text: "s1 gets this at its next step", reach: { kind: "agent" } })
    expect(status(sent, board([task()], [session("s1", { lastSeenAt: now - 20 * MIN, waiting: true })])))
      .toMatchObject({ tone: "ok", text: "s1 is waiting for you: it gets this in about a second" })
    expect(status(sent, board([task()], [session("s1", { lastSeenAt: now - 20 * MIN })])))
      .toMatchObject({ tone: "idle", text: "s1 is idle: it gets this when it next works" })
    expect(status(sent, board([task()], [session("s1", { endedAt: now - 10 * MIN })])))
      .toMatchObject({ tone: "idle", text: "s1 ended: it gets this if the session is resumed" })
  })

  it("taken, while the holder works: it got it and is working on it", () => {
    const taken = comment("c", now - MIN, sentTo("s1", now - MIN + 2_000, "hook"))
    expect(status(taken, active)).toMatchObject({ tone: "ok", text: "s1 got your comment and is working on it…", reach: { kind: "agent" } })
    const idleWithBuilder = board([task()], [session("s1", { lastSeenAt: now - 20 * MIN })], [builder()])
    expect(status(taken, idleWithBuilder)).toMatchObject({ text: "s1 got your comment and is working on it…" })
  })

  it("taken, then the holder stopped without answering: it got it but hasn't answered", () => {
    const taken = comment("c", now - 30 * MIN, sentTo("s1", now - 29 * MIN, "hook"))
    expect(status(taken, board([task()], [session("s1", { lastSeenAt: now - 20 * MIN })])))
      .toMatchObject({ tone: "idle", text: "s1 got your comment but hasn't answered yet" })
    // Ended its turn with `cello inbox --wait` running: waiting for Lucas, not working on it.
    expect(status(taken, board([task()], [session("s1", { waiting: true })])))
      .toMatchObject({ tone: "idle", text: "s1 got your comment but hasn't answered yet" })
    const released = task({ assigneeActorId: null, assigneeSessionId: null })
    expect(status(taken, board([released], [session("s1")]), released))
      .toEqual({ tone: "idle", text: "s1 got your comment but hasn't answered yet", reach: null, mood: "still" })
  })

  // CEL-76 follow-up: Lucas wants the mark alive while the agent works on his comment.
  it("the mark thinks only while the holder works on the comment it took; otherwise it keeps still", () => {
    const taken = comment("c", now - MIN, sentTo("s1", now - MIN + 2_000, "hook"))
    expect(status(taken, active)).toMatchObject({ text: "s1 got your comment and is working on it…", mood: "thinking" })
    expect(status(taken, board([task()], [session("s1")], [builder()]))).toMatchObject({ mood: "thinking" })
    // Got it, then stopped: idle, or waiting in `cello inbox --wait` (its pose, which doesn't move).
    expect(status(taken, board([task()], [session("s1", { lastSeenAt: now - 20 * MIN })]))).toMatchObject({ mood: "still" })
    expect(status(taken, board([task()], [session("s1", { waiting: true })]))).toMatchObject({ mood: "waiting" })
    expect(status(taken, board([task()], [session("s1", { endedAt: now - 10 * MIN })]))).toMatchObject({ mood: "still" })
    // Not taken yet: nothing to think about, whatever the holder is doing.
    const sent = comment("c", now - MIN, sentTo("s1"))
    expect(status(sent, active)).toMatchObject({ text: "s1 gets this at its next step", mood: "still" })
    expect(status(sent, board([task()], [session("s1", { waiting: true })]))).toMatchObject({ mood: "waiting" })
    expect(status(sent, board([task()], [session("s1", { lastSeenAt: now - 20 * MIN })]))).toMatchObject({ mood: "still" })
  })

  it("taken by its waiting `cello inbox --wait`: working on it at once (the server says it woke, in the same change)", () => {
    // Waiting since long ago; the waiter took the comment a second after Lucas wrote it, and the board
    // heard the session seen at that moment and no longer waiting.
    const taken = comment("c", now - 5_000, sentTo("s1", now - 4_000, "wait"))
    const woke = board([task()], [session("s1", { lastSeenAt: now - 4_000, waiting: false })])
    expect(status(taken, woke)).toEqual({
      tone: "ok",
      text: "s1 got your comment and is working on it…",
      reach: expect.objectContaining({ kind: "agent", presence: "active", waiting: false }),
      mood: "thinking",
    })
    // It finished without answering and waits again: it hasn't answered, and the mark stops.
    const waitsAgain = board([task()], [session("s1", { lastSeenAt: now - 4_000, waiting: true })])
    expect(status(taken, waitsAgain)).toMatchObject({ tone: "idle", text: "s1 got your comment but hasn't answered yet", mood: "waiting" })
  })

  it("answered (a reply or reaction after taking it): no row", () => {
    const taken = comment("c", now - 5 * MIN, sentTo("s1", now - 4 * MIN, "hook"))
    const reply = comment("r", now - 2 * MIN, { actorId: "claude", sessionId: "s1" })
    expect(status(taken, active, task(), [taken, reply])).toBeNull()
  })

  it("went to nobody: warns while nobody holds the task and agents work on it; else no row", () => {
    const free = task({ assigneeActorId: null, assigneeSessionId: null, updatedBySessionId: "s1" })
    const c = comment("c", now - MIN, { delivery: null })
    expect(status(c, board([free], [session("s1")]), free)).toEqual({ tone: "warn", text: "No agent holds this task: nobody will get this", reach: { kind: "nobody" }, mood: "still" })
    // A task no agent ever touched: a plain thread, no warning under each comment.
    const untouched = task({ assigneeActorId: null, assigneeSessionId: null })
    expect(status(c, board([untouched], []), untouched)).toBeNull()
    // Claimed after it was written: it still went nowhere (its tick says Not delivered), so no row promising otherwise.
    expect(status(c, active)).toBeNull()
  })

  it("still waiting in a session that let the task go: no row (its tick names that inbox)", () => {
    const sent = comment("c", now - MIN, sentTo("s2"))
    expect(status(sent, board([task()], [session("s1"), session("s2")]))).toBeNull()
  })

  it("an agent's comment has no row", () => {
    const own = comment("c", now - MIN, { actorId: "claude", sessionId: "s1" })
    expect(status(own, active)).toBeNull()
  })
})
