// CEL-76: delivery receipts on Lucas's comments, and who gets the next one.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, Comment, Reaction, SessionAgent, Task, TaskWake } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import {
  commentStatus,
  durationShort,
  reachOf,
  reachWords,
  receiptOf,
  receiptTitle,
  reopenOf,
  reopenWords,
  sentWords,
  statusCommentId,
  unsentTone,
  wakeHintOf,
  wakeHintWords,
} from "./receipts.ts"

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
  documents: {}, wakes: {}, milestones: {},
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

  it("delivered says where the session took it (CEL-137): where it runs, or Woken by Cello when a woken run took it", () => {
    const taken = comment("c", now - MIN, sentTo("s1", now - MIN + 12_000, "inbox"))
    expect(receiptOf(taken, [taken], board([task()], [session("s1", { entrypoint: "claude-desktop" })]))).toMatchObject({ origin: "Claude desktop" })
    const run = { id: "r1", startedAt: now - MIN + 5_000, endedAt: now - MIN + 40_000 }
    expect(receiptOf(taken, [taken], board([task()], [session("s1", { entrypoint: "claude-desktop", lastRun: run })]))).toMatchObject({ origin: "Woken by Cello" })
    // A run before it took the comment, or after, doesn't count.
    const later = { id: "r2", startedAt: now - MIN + 20_000, endedAt: null }
    expect(receiptOf(taken, [taken], board([task()], [session("s1", { entrypoint: "cli", terminal: "WezTerm", lastRun: later })]))).toMatchObject({ origin: "Terminal · WezTerm" })
    expect(receiptOf(taken, [taken], board([task()], [session("s1", { entrypoint: null })]))).toMatchObject({ origin: null })
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

// CEL-136: when Cello wakes the session, the row says so right away: a wake due (with a countdown and
// Wake now), the run starting, then the usual delivered and working; or why it won't wake.
describe("commentStatus while Cello wakes the session (CEL-136)", () => {
  const ended = session("0ee027f0-aaaa", { endedAt: now - 10 * MIN, lastSeenAt: now - 20 * MIN })
  const held = task({ assigneeSessionId: "0ee027f0-aaaa" })
  const sent = comment("c", now - 2_000, sentTo("0ee027f0-aaaa"))
  const wake = (extra: Partial<TaskWake>): TaskWake => ({
    taskId: "t1", sessionId: "0ee027f0-aaaa", state: "scheduled", why: "comment", ts: now - 1_000, at: now + 29_000, reason: null, run: null, ...extra,
  })
  const run = { id: "r1", sessionId: "0ee027f0-aaaa", taskId: "t1", why: "comment" as const, agentKind: "claude-code", mode: "auto", celloMode: "auto" as const, pid: 7, startedAt: now - 1_000, endedAt: null, exitCode: null, outcome: "running" as const, error: null }
  const state = (w: TaskWake | null, s: AgentSession = ended): BoardState => ({ ...board([held], [s]), wakes: w ? { t1: w } : {} })
  const status = (c: Comment, b: BoardState, at = now) => commentStatus(c, [c], held, b, at)

  it("a wake due: waking it in so many seconds, counting down to when it's due, with Wake now", () => {
    expect(status(sent, state(wake({})))).toEqual({
      tone: "ok",
      text: "Waking 0ee027f0 in 29 s · more comments join this wake",
      reach: expect.objectContaining({ kind: "agent", presence: "ended" }),
      mood: "still",
      wake: "scheduled",
      due: now + 29_000,
    })
    expect(status(sent, state(wake({})), now + 20_500)?.text).toBe("Waking 0ee027f0 in 9 s · more comments join this wake")
    // Due, and the run about to start.
    expect(status(sent, state(wake({})), now + 29_000)).toMatchObject({ text: "Waking 0ee027f0…", due: now + 29_000 })
    // Long past due and nothing happened (another task's run took it): back to the plain words.
    expect(status(sent, state(wake({})), now + 5 * MIN)).toMatchObject({ text: "0ee027f0 ended: it gets this if the session is resumed" })
  })

  it("the run started: waking it, starting its agent, the mark at work; then the usual words once it took the comment", () => {
    const running = { ...ended, lastRun: { id: "r1", startedAt: now - 1_000, endedAt: null } }
    const start = wake({ state: "running", run, at: null })
    expect(status(sent, state(start, running))).toEqual({
      tone: "ok",
      text: "Waking 0ee027f0… starting Claude Code",
      reach: expect.objectContaining({ kind: "agent", presence: "active" }),
      mood: "thinking",
      wake: "starting",
    })
    const taken = comment("c", now - 2_000, sentTo("0ee027f0-aaaa", now - 500, "inbox"))
    expect(status(taken, state(start, running))).toMatchObject({ text: "0ee027f0 got your comment and is working on it…", mood: "thinking" })
  })

  it("not woken: why, right away", () => {
    expect(status(sent, state(wake({ state: "not_woken", at: null, reason: "cap" })))).toMatchObject({
      tone: "idle",
      text: "Not waking 0ee027f0: the limit of wakes for this task in the last hour is reached: open the chat to continue",
      mood: "still",
    })
    expect(status(sent, state(wake({ state: "not_woken", at: null, reason: "cancelled" })))?.text).toBe("Not waking 0ee027f0: you said don't wake it")
    // Off (the default): it ended, and says waking is off.
    expect(status(sent, state(wake({ state: "not_woken", at: null, reason: "disabled" })))?.text).toBe(
      "0ee027f0 ended: it gets this if the session is resumed (waking is off for this project)",
    )
  })

  it("a woken run that ended before taking it says how it ended; a failure warns", () => {
    const failed = wake({ state: "ended", at: null, run: { ...run, endedAt: now, outcome: "failed", error: "claude exited 1" } })
    expect(status(sent, state(failed))).toMatchObject({ tone: "warn", text: "0ee027f0's woken run failed after 1 s: claude exited 1" })
  })

  it("only a wake about this comment counts: one from before it, or of another session, leaves the usual words", () => {
    expect(status(sent, state(wake({ ts: now - 5_000, state: "not_woken", at: null, reason: "cap" })))?.text).toBe("0ee027f0 ended: it gets this if the session is resumed")
    expect(status(sent, state(wake({ sessionId: "other" })))?.text).toBe("0ee027f0 ended: it gets this if the session is resumed")
  })
})

describe("wakeHintOf: the comment box says beforehand that a comment wakes the session (CEL-136)", () => {
  const ended = session("0ee027f0-aaaa", { endedAt: now - 10 * MIN })
  const held = task({ assigneeSessionId: "0ee027f0-aaaa" })
  const on = { enabled: true, batchMs: 30_000 }

  it("waking on, the holder's process gone: who it wakes and how long after the last comment", () => {
    const hint = wakeHintOf(board([held], [ended]), held, on, now)
    expect(hint).toMatchObject({ who: { short: "0ee027f0" }, batchMs: 30_000 })
    expect(wakeHintWords(hint!)).toBe("Commenting wakes 0ee027f0 (30 s after your last comment)")
  })

  it("nothing when waking is off or unknown, the holder is running or listening, Cello is running it, it has no pid, or nobody holds it", () => {
    expect(wakeHintOf(board([held], [ended]), held, { ...on, enabled: false }, now)).toBeNull()
    expect(wakeHintOf(board([held], [ended]), held, null, now)).toBeNull()
    expect(wakeHintOf(board([held], [session("0ee027f0-aaaa")]), held, on, now)).toBeNull()
    expect(wakeHintOf(board([held], [{ ...ended, waiting: true }]), held, on, now)).toBeNull()
    expect(wakeHintOf(board([held], [{ ...ended, lastRun: { id: "r", startedAt: now - MIN, endedAt: null } }]), held, on, now)).toBeNull()
    expect(wakeHintOf(board([held], [{ ...ended, pid: null }]), held, on, now)).toBeNull()
    const free = task({ assigneeActorId: null, assigneeSessionId: null })
    expect(wakeHintOf(board([free], [ended]), free, on, now)).toBeNull()
  })

  it("an older server's settings without the wait: 30 s", () => {
    expect(wakeHintWords(wakeHintOf(board([held], [ended]), held, { enabled: true }, now)!)).toBe("Commenting wakes 0ee027f0 (30 s after your last comment)")
  })

  it("nothing while the task's last wake hit the cap within the hour: the next comment wouldn't wake it either", () => {
    const capped = (ts: number): BoardState => ({
      ...board([held], [ended]),
      wakes: { t1: { taskId: "t1", sessionId: "0ee027f0-aaaa", state: "not_woken", why: "comment", ts, at: null, reason: "cap", run: null } },
    })
    expect(wakeHintOf(capped(now - 10 * MIN), held, on, now)).toBeNull()
    expect(wakeHintOf(capped(now - 61 * MIN), held, on, now)).not.toBeNull()
  })

  it("on a task nobody holds, the session the comment goes back to (CEL-110)", () => {
    const free = task({ assigneeActorId: null, assigneeSessionId: null, lastHolderSessionId: "0ee027f0-aaaa" })
    expect(wakeHintOf(board([free], [ended]), free, on, now)).toMatchObject({ who: { short: "0ee027f0" } })
  })
})

// CEL-110: the comment box says beforehand that a comment on a task nobody holds goes to the agent that
// last worked on it, and reopens the task for it.
describe("reopenOf and reopenWords: what a comment on a task nobody holds will do", () => {
  const statuses = {
    todo: { id: "todo", workspaceId: "w", name: "Todo", category: "unstarted", position: "a0", color: "#999", hidden: false, createdAt: 1, updatedAt: 1 },
    prog: { id: "prog", workspaceId: "w", name: "In Progress", category: "started", position: "a1", color: "#f2c94c", hidden: false, createdAt: 1, updatedAt: 1 },
    done: { id: "done", workspaceId: "w", name: "Done", category: "completed", position: "a3", color: "#4cb782", hidden: false, createdAt: 1, updatedAt: 1 },
  } satisfies BoardState["statuses"]
  const free = (extra: Partial<Task>) => task({ assigneeActorId: null, assigneeSessionId: null, stage: null, lastHolderSessionId: "7330433e-aaaa", ...extra })
  const state = (t: Task) => ({ ...board([t], [session("7330433e-aaaa", { endedAt: now - 10 * MIN })]), statuses })

  it("a Done task reopens and goes to the session that last held it, named as everywhere else", () => {
    const t = free({ key: "CEL-94", statusId: "done" })
    const r = reopenOf(state(t), t)
    expect(r).toMatchObject({ reopens: true, who: { name: "Claude Code session 7330433e", short: "7330433e" } })
    expect(reopenWords(t, r!)).toBe("Commenting reopens CEL-94 and sends it to Claude Code session 7330433e")
  })

  it("a released task still In Progress isn't reopened: the comment gives it back", () => {
    const t = free({ key: "CEL-94", statusId: "prog" })
    const r = reopenOf(state(t), t)!
    expect(r.reopens).toBe(false)
    expect(reopenWords(t, r)).toBe("Commenting gives CEL-94 back to Claude Code session 7330433e and sends it your comment")
  })

  it("nothing to say for a task someone holds, an archived one, or one no agent ever held", () => {
    for (const t of [
      free({ statusId: "done", assigneeActorId: "claude", assigneeSessionId: "s1" }),
      free({ statusId: "done", assigneeActorId: "lucas" }),
      free({ statusId: "done", archivedAt: now }),
      free({ statusId: "todo", lastHolderSessionId: null }),
      task({ assigneeActorId: null, assigneeSessionId: null }),
    ]) expect(reopenOf(state(t), t)).toBeNull()
  })
})
