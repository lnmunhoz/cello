import type { CelloEvent, EventBody } from "@cello/contract/events"
import type { BoardState } from "./sync/applyEvents.ts"
import { describe, expect, it } from "vitest"
import { decodeEvent } from "@cello/contract/events"
import { describeEvent } from "./history.ts"

const state = {
  seq: 1,
  actors: { me: { id: "me", kind: "human", name: "Lucas", client: null, color: "#000", createdAt: 1 } },
  workspaces: {},
  projects: {},
  statuses: {
    todo: { id: "todo", workspaceId: "w", name: "Todo", category: "unstarted", position: "a0", color: "#999", hidden: false, createdAt: 1, updatedAt: 1 },
    doing: { id: "doing", workspaceId: "w", name: "In Progress", category: "started", position: "a1", color: "#f2c94c", hidden: false, createdAt: 1, updatedAt: 1 },
  },
  labels: { bug: { id: "bug", workspaceId: "w", name: "Bug", color: "#f00", createdAt: 1, updatedAt: 1, archivedAt: null } },
  milestones: {
    m2: { id: "m2", projectId: "p", name: "M2", goal: "", targetDate: null, position: "a0", state: "open", closedAt: null, createdAt: 1, updatedAt: 1 },
    m3: { id: "m3", projectId: "p", name: "M3", goal: "", targetDate: null, position: "a1", state: "open", closedAt: null, createdAt: 1, updatedAt: 1 },
  },
  tasks: {},
} as unknown as BoardState

const ev = (body: EventBody, actorId = "me"): CelloEvent =>
  ({ seq: 1, ts: 1, commandId: "c", actorId, sessionId: null, workspaceId: "w", projectId: "p", schemaVersion: 1, ...body }) as CelloEvent

describe("describeEvent", () => {
  it("says who did what in plain words", () => {
    expect(describeEvent(ev({ type: "task.created", task: {} as never }), state)).toBe("Lucas created the task")
    expect(
      describeEvent(ev({ type: "task.moved", id: "t", from: { statusId: "todo", position: "a" }, to: { statusId: "doing", position: "b" }, version: 2, task: {} as never }), state),
    ).toBe("Lucas moved it from Todo to In Progress")
    expect(
      describeEvent(ev({ type: "task.moved", id: "t", from: { statusId: "todo", position: "a" }, to: { statusId: "todo", position: "b" }, version: 2, task: {} as never }), state),
    ).toBe("Lucas reordered it in Todo")
    expect(describeEvent(ev({ type: "task.updated", id: "t", before: { title: "a" }, after: { title: "b", priority: 2 }, version: 2 }), state)).toBe(
      "Lucas changed the title and priority",
    )
    expect(describeEvent(ev({ type: "task.labels_changed", id: "t", added: ["bug"], removed: [], version: 2 }), state)).toBe("Lucas added Bug")
    expect(describeEvent(ev({ type: "comment.added", comment: {} as never }, "ghost"), state)).toBe("Someone commented")
  })

  it("says what became of a task's milestone, and of the labels the migration turned into one (CEL-113)", () => {
    const changed = (before: string | null, after: string | null, fromLabels?: ReadonlyArray<string>) =>
      describeEvent(ev({ type: "task.milestone_changed", id: "t", version: 2, before, after, ...(fromLabels ? { fromLabels } : {}) }), state)
    expect(changed(null, "m3")).toBe("Lucas put it in M3")
    expect(changed("m2", "m3")).toBe("Lucas moved it from M2 to M3")
    expect(changed("m3", null)).toBe("Lucas took it out of M3")
    expect(changed(null, "gone")).toBe("Lucas put it in a milestone")
    // Without the names (`cello task get` has none from an old server), still a line.
    expect(describeEvent(ev({ type: "task.milestone_changed", id: "t", version: 2, before: null, after: "m3" }), { ...state, milestones: undefined } as never)).toBe(
      "Lucas put it in a milestone",
    )
    expect(changed(null, "m3", ["M3"])).toBe("Cello turned its M3 label into the milestone M3")
    expect(changed(null, "m3", ["M3", "M2"])).toBe("Cello turned its M3 label into the milestone M3 (it also had M2; a task is in one milestone, so the later one)")
    expect(describeEvent(ev({ type: "milestone.created", milestone: state.milestones["m3"]! }), state)).toBe("Lucas created the milestone M3")
    expect(describeEvent(ev({ type: "milestone.closed", id: "m3" }), state)).toBe("Lucas closed M3")
    expect(describeEvent(ev({ type: "milestone.reopened", id: "m3" }), state)).toBe("Lucas reopened M3")
    expect(describeEvent(ev({ type: "milestone.updated", id: "m3", before: {}, after: { goal: "x", targetDate: null } }), state)).toBe("Lucas changed M3's goal and target date")
  })

  it("says which testing-profile fields changed, were unset or confirmed (CEL-89)", () => {
    const field = (name: string, value: string) => ({ field: name, value, source: "agent" as const, updatedAt: 1, actorId: "me", sessionId: null })
    const changed = (changes: ReadonlyArray<{ field: string; before: ReturnType<typeof field> | null; after: ReturnType<typeof field> | null }>) =>
      describeEvent(ev({ type: "profile.changed", project: "p", changes }), state)
    expect(changed([{ field: "unit", before: null, after: field("unit", "bun run test") }])).toBe("Lucas set the testing profile's unit to `bun run test`")
    expect(changed([{ field: "unit", before: field("unit", "a"), after: null }])).toBe("Lucas unset the testing profile's unit")
    expect(changed([{ field: "unit", before: field("unit", "a"), after: field("unit", "a") }])).toBe("Lucas confirmed the testing profile's unit")
    expect(changed([
      { field: "install", before: null, after: field("install", "bun install") },
      { field: "unit", before: field("unit", "a"), after: null },
    ])).toBe("Lucas changed the testing profile: set install, unset unit")
  })

  it("says which emoji a reaction was (CEL-77)", () => {
    const reaction = { id: "x", commentId: "c", taskId: "t", emoji: "👍", actorId: "me", sessionId: null, createdAt: 1 }
    expect(describeEvent(ev({ type: "reaction.added", reaction }), state)).toBe("Lucas reacted 👍 to a comment")
    expect(describeEvent(ev({ type: "reaction.removed", reaction }), state)).toBe("Lucas took back their 👍")
  })

  it("says a session took the human's comment (CEL-76)", () => {
    const delivered = ev({ type: "comment.delivered", commentId: "c", taskId: "t", session: "s1", via: "hook" })
    expect(describeEvent(delivered, state, "Claude Code session 2fd0505c")).toBe("Claude Code session 2fd0505c took Lucas's comment")
    expect(describeEvent(delivered, { ...state, actors: {} }, "Claude Code session 2fd0505c")).toBe("Claude Code session 2fd0505c took a comment")
  })

  it("names the stage by its label, and says when it was cleared", () => {
    expect(describeEvent(ev({ type: "task.stage_changed", id: "t", version: 2, before: null, after: "review" }), state)).toBe(
      "Lucas set the stage to Agent review",
    )
    expect(describeEvent(ev({ type: "task.stage_changed", id: "t", version: 3, before: "review", after: null }), state)).toBe(
      "Lucas cleared the stage",
    )
  })

  it("describes reviews", () => {
    expect(describeEvent(ev({ type: "review.submitted", review: {} as never }), state)).toBe("Lucas submitted a review")
    const decided = (decision: "approved" | "sent_back" | "superseded") =>
      describeEvent(ev({ type: "review.decided", id: "r", taskId: "t", decision, note: null }), state)
    expect(decided("approved")).toBe("Lucas approved the review")
    expect(decided("sent_back")).toBe("Lucas sent it back")
    expect(decided("superseded")).toBe("Lucas replaced the open review")
    expect(describeEvent(ev({ type: "review.withdrawn", id: "r", taskId: "t", to: "doing" }), state)).toBe(
      "Lucas moved it to In Progress, withdrawing the open review",
    )
  })

  it("describes claims", () => {
    const from = { actorId: "agent", sessionId: "s1" }
    expect(describeEvent(ev({ type: "task.claimed", id: "t", version: 2, task: {} as never }), state)).toBe("Lucas claimed it")
    expect(describeEvent(ev({ type: "task.claim_taken", id: "t", version: 3, task: {} as never, from, reason: "human" }), state)).toBe(
      "Lucas took over the claim",
    )
    expect(describeEvent(ev({ type: "task.claim_taken", id: "t", version: 3, task: {} as never, from, reason: "holder_exited" }), state)).toBe(
      "Lucas took over the claim (its session had exited)",
    )
    expect(describeEvent(ev({ type: "task.claim_taken", id: "t", version: 3, task: {} as never, from, reason: "holder_idle" }), state)).toBe(
      "Lucas took over the claim (its session was quiet for 2 hours)",
    )
    expect(describeEvent(ev({ type: "task.released", id: "t", version: 4, task: {} as never }), state)).toBe("Lucas released it")
    expect(describeEvent(ev({ type: "task.claim_ended", id: "t", version: 4, from, reason: "human_change" }), state)).toBe(
      "Lucas's change ended the agent's claim",
    )
  })

  it("describes a comment reopening the task for its last session (CEL-110), naming it when the caller can", () => {
    const reopened = (from: string) => ev({ type: "task.reopened", id: "t", version: 6, task: { statusId: "doing" } as never, from, session: "s1" })
    const named = { ...state, sessionName: (id: string) => (id === "s1" ? "Claude Code session 7330433e" : id) }
    expect(describeEvent(reopened("todo"), named)).toBe("Lucas's comment reopened it for Claude Code session 7330433e")
    // Released, still In Progress: nothing to reopen, the claim just goes back.
    expect(describeEvent(reopened("doing"), named)).toBe("Lucas's comment gave it back to Claude Code session 7330433e")
    expect(describeEvent(reopened("todo"), state)).toBe("Lucas's comment reopened it for the agent session that last held it")
  })
})

describe("describeEvent: an old stage (CEL-105)", () => {
  it("a stage change stored as `designing`, before it was renamed, reads as Planning", () => {
    const stored = decodeEvent({ seq: 1, ts: 1, commandId: "c", actorId: "me", sessionId: null, workspaceId: "w", projectId: "p", schemaVersion: 1, type: "task.stage_changed", id: "t", version: 3, before: null, after: "designing" })
    expect(describeEvent(stored, state)).toBe("Lucas set the stage to Planning")
  })
})

describe("describeEvent with a name (CEL-55)", () => {
  it("names who the caller says: a subagent under its session", () => {
    expect(describeEvent(ev({ type: "task.stage_changed", id: "t", version: 3, before: null, after: "building" }, "claude"), state, "cello-builder · a13bfb89"))
      .toBe("cello-builder · a13bfb89 set the stage to Building")
  })

  it("says what an agent check-in was", () => {
    const agent = { sessionId: "s1", agentId: "a13bfb89", agentType: "cello-builder", taskId: "t", description: null, startedAt: 1, lastSeenAt: 2, endedAt: null }
    expect(describeEvent(ev({ type: "agent.seen", agent }), state, "cello-builder · a13bfb89")).toBe("cello-builder · a13bfb89 checked in")
    expect(describeEvent(ev({ type: "agent.seen", agent: { ...agent, endedAt: 3 } }), state, "cello-builder · a13bfb89")).toBe("cello-builder · a13bfb89 finished")
  })

  it("orchestrate mode (CEL-124): the session started or stopped orchestrating", () => {
    const who = "Claude Code session c14ca1fa"
    expect(describeEvent(ev({ type: "session.orchestrating", session: "s1", orchestrating: true }), state, who)).toBe("Claude Code session c14ca1fa started orchestrating")
    expect(describeEvent(ev({ type: "session.orchestrating", session: "s1", orchestrating: false }), state, who)).toBe("Claude Code session c14ca1fa stopped orchestrating")
  })

  it("waking sessions (CEL-92): what Cello did with the session, and what Lucas changed in the settings", () => {
    const run = { id: "r1", sessionId: "s1", taskId: "t1", why: "comment" as const, agentKind: "claude-code", mode: "auto", celloMode: "auto" as const, pid: 7, startedAt: 1_000, endedAt: null, exitCode: null, outcome: "running" as const, error: null }
    const who = "Claude Code session c14ca1fa"
    expect(describeEvent(ev({ type: "session.wake_scheduled", session: "s1", taskId: "t1", why: "comment", at: 31_000 }), state, who))
      .toBe("Cello will wake Claude Code session c14ca1fa (a comment)")
    expect(describeEvent(ev({ type: "session.not_woken", session: "s1", taskId: "t1", why: "comment", reason: "disabled" }), state, who))
      .toBe("Cello didn't wake Claude Code session c14ca1fa: waking is off for this project")
    expect(describeEvent(ev({ type: "session.run_started", run }), state, who)).toBe("Cello woke Claude Code session c14ca1fa (a comment, mode auto)")
    expect(describeEvent(ev({ type: "session.run_ended", run: { ...run, endedAt: 61_000, outcome: "completed", exitCode: 0 } }), state, who))
      .toBe("Claude Code session c14ca1fa's woken run completed in 1 min")
    expect(describeEvent(ev({ type: "session.run_ended", run: { ...run, endedAt: 41_000, outcome: "stopped" } }), state, who))
      .toBe("Claude Code session c14ca1fa's woken run was stopped after 40 s")
    expect(describeEvent(ev({ type: "wake.settings_changed", project: "p", before: { enabled: false }, after: { enabled: true } }), state))
      .toBe("Lucas turned waking agent sessions on")
    expect(describeEvent(ev({ type: "wake.settings_changed", project: "p", before: { capPerHour: 3 }, after: { capPerHour: 5 } }), state))
      .toBe("Lucas set the wake limit to 5 per task per hour")
  })
})

// CEL-119: the history names an agent with its role and model as the subject of a line ("cello-builder
// (Sonnet 5.5), subagent of d0d47d35, set the stage…"), and by its plain name where it's possessive or
// what Cello did to it.
describe("describeEvent with a subject and a plain name (CEL-119)", () => {
  const builder = { subject: "cello-builder (Sonnet 5.5), subagent of d0d47d35,", plain: "cello-builder · b1d3e5f7" }
  const main = { subject: "Claude Code (Opus 5.5), main session d0d47d35,", plain: "Claude Code session d0d47d35" }

  it("leads a line with the subject, its closing comma included", () => {
    expect(describeEvent(ev({ type: "task.stage_changed", id: "t", version: 3, before: null, after: "review" }, "claude"), state, builder))
      .toBe("cello-builder (Sonnet 5.5), subagent of d0d47d35, set the stage to Agent review")
    expect(describeEvent(ev({ type: "comment.added", comment: {} as never }, "claude"), state, main)).toBe("Claude Code (Opus 5.5), main session d0d47d35, commented")
  })

  it("uses the plain name where it's possessive or what Cello did to the session", () => {
    const run = { id: "r1", sessionId: "s1", taskId: "t1", why: "comment" as const, agentKind: "claude-code", mode: "auto", celloMode: "auto" as const, pid: 7, startedAt: 1_000, endedAt: 61_000, exitCode: 0, outcome: "completed" as const, error: null }
    const session = { id: "s1", actorId: "claude", externalId: "d0d47d35", clientName: "Claude Code", entrypoint: null, cwd: null, pid: null, startedAt: 1, lastSeenAt: 2, endedAt: 3 }
    expect(describeEvent(ev({ type: "session.seen", session }, "claude"), state, main)).toBe("Claude Code session d0d47d35's session ended")
    expect(describeEvent(ev({ type: "task.claim_ended", id: "t", version: 4, from: { actorId: "claude", sessionId: "s1" }, reason: "human_change" }, "claude"), state, main))
      .toMatch(/^Claude Code session d0d47d35's change ended/)
    expect(describeEvent(ev({ type: "session.run_started", run }), state, main)).toBe("Cello woke Claude Code session d0d47d35 (a comment, mode auto)")
    expect(describeEvent(ev({ type: "session.wake_scheduled", session: "s1", taskId: "t1", why: "comment", at: 31_000 }), state, main))
      .toBe("Cello will wake Claude Code session d0d47d35 (a comment)")
    expect(describeEvent(ev({ type: "session.not_woken", session: "s1", taskId: "t1", why: "comment", reason: "disabled" }), state, main))
      .toMatch(/^Cello didn't wake Claude Code session d0d47d35:/)
    expect(describeEvent(ev({ type: "session.run_ended", run }), state, main)).toBe("Claude Code session d0d47d35's woken run completed in 1 min")
  })
})
