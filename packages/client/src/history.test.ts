import type { CelloEvent, EventBody } from "@cello/contract/events"
import type { BoardState } from "./sync/applyEvents.ts"
import { describe, expect, it } from "vitest"
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

  it("describes reviews", () => {
    expect(describeEvent(ev({ type: "review.submitted", review: {} as never }), state)).toBe("Lucas submitted a review")
    const decided = (decision: "approved" | "sent_back" | "superseded") =>
      describeEvent(ev({ type: "review.decided", id: "r", taskId: "t", decision, note: null }), state)
    expect(decided("approved")).toBe("Lucas approved the review")
    expect(decided("sent_back")).toBe("Lucas sent it back")
    expect(decided("superseded")).toBe("Lucas replaced the open review")
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
})
