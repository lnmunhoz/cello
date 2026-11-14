import type { Attachment, Project, Review, Status, Task } from "@cello/contract/entities"
import type { CelloEvent, EventBody } from "@cello/contract/events"
import { describe, expect, it } from "vitest"
import type { BoardState } from "./applyEvents.ts"
import { applyReviewEvents, attachmentUrl, openReviewOf, posterUrl, reviewQueue, thumbnailOf } from "./reviews.ts"

const status = (id: string, name: string, category: Status["category"], position: string): Status => ({
  id, workspaceId: "w1", name, category, position, color: "#999", hidden: false, createdAt: 1, updatedAt: 1,
})
const project = (id: string, key: string, workspaceId = "w1"): Project => ({
  id, workspaceId, name: key, key, color: "#000", description: "", repoPath: null, createdAt: 1, updatedAt: 1, archivedAt: null,
})
const task = (id: string, statusId: string, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number: 1, key: `CEL-${id}`, title: id, description: "", statusId, priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me",
  createdBySessionId: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})
const attachment = (id: string, kind: Attachment["kind"], extra: Partial<Attachment> = {}): Attachment => ({
  id, taskId: "t1", reviewId: "r1", kind, name: `${id}.bin`, url: null, caption: "", mime: null, bytes: 10, hasPoster: false,
  actorId: "agent", sessionId: "s1", createdAt: 1, deletedAt: null, ...extra,
})
const review = (id: string, taskId: string, createdAt: number, attachments: Attachment[] = []): Review => ({
  id, taskId, summary: "Done", steps: ["Look"], attachments, actorId: "agent", sessionId: "s1", author: { name: "Claude Code", session: "2fd0505c" }, createdAt,
  decidedAt: null, decision: null, decisionNote: null,
})

const state: BoardState = {
  seq: 1,
  actors: {},
  workspaces: {},
  projects: { p1: project("p1", "CEL"), p2: project("p2", "ZED"), p9: project("p9", "FAR", "w2") },
  statuses: {
    doing: status("doing", "In Progress", "started", "a2"),
    review: status("review", "In Review", "started", "a3"),
    done: status("done", "Done", "completed", "a4"),
  },
  labels: {},
  tasks: {
    t1: task("t1", "review"),
    t2: task("t2", "review", { projectId: "p2" }),
    t3: task("t3", "review"), // moved to In Review by hand: no packet
    t4: task("t4", "done"), // its packet still waits for a decision
    t5: task("t5", "doing"),
    gone: task("gone", "review", { archivedAt: 5 }),
    far: task("far", "review", { projectId: "p9" }),
  },
  reviews: {
    r1: review("r1", "t1", 30),
    r2: review("r2", "t2", 10),
    r4: review("r4", "t4", 20),
    rg: review("rg", "gone", 5),
  },
}

const ev = (seq: number, body: EventBody): CelloEvent =>
  ({ seq, ts: seq, commandId: `c${seq}`, actorId: "me", sessionId: null, workspaceId: "w1", projectId: "p1", schemaVersion: 1, ...body }) as CelloEvent

describe("the review queue", () => {
  it("lists every task waiting on Lucas across the workspace's projects, oldest packet first, then tasks without one", () => {
    const queue = reviewQueue(state, "w1")
    expect(queue.map((i) => [i.task.id, i.review?.id ?? null, i.project.key])).toEqual([
      ["t2", "r2", "ZED"],
      ["t4", "r4", "CEL"],
      ["t1", "r1", "CEL"],
      ["t3", null, "CEL"],
    ])
  })

  it("finds a task's open review", () => {
    expect(openReviewOf(state, "t1")?.id).toBe("r1")
    expect(openReviewOf(state, "t5")).toBeUndefined()
  })
})

describe("evidence", () => {
  it("files are served at /attachments/<id>, posters at /attachments/<id>/poster", () => {
    expect(attachmentUrl(attachment("a1", "image"))).toBe("/attachments/a1")
    expect(posterUrl(attachment("v1", "video", { hasPoster: true }))).toBe("/attachments/v1/poster")
    expect(posterUrl(attachment("v2", "video"))).toBeUndefined()
  })

  it("a card's thumbnail is the first video poster, else the first screenshot", () => {
    const shot = attachment("s1", "image")
    const video = attachment("v1", "video", { hasPoster: true })
    expect(thumbnailOf(review("r", "t", 1, [attachment("l", "link"), shot, video]))).toBe("/attachments/v1/poster")
    expect(thumbnailOf(review("r", "t", 1, [attachment("v0", "video"), shot]))).toBe("/attachments/s1")
    expect(thumbnailOf(review("r", "t", 1, [attachment("f", "file")]))).toBeNull()
  })
})

describe("applyReviewEvents", () => {
  it("keeps a task's loaded reviews current: new packets join, decisions close them", () => {
    const first = review("r1", "t1", 1)
    const list = [first]
    const second = review("r2", "t1", 2)
    const next = applyReviewEvents(list, "t1", [
      ev(2, { type: "review.decided", id: "r1", taskId: "t1", decision: "superseded", note: null }),
      ev(2, { type: "review.submitted", review: second }),
      ev(3, { type: "review.submitted", review: review("x", "other", 3) }),
    ])
    expect(next.map((r) => [r.id, r.decision, r.decidedAt])).toEqual([["r1", "superseded", 2], ["r2", null, null]])
    expect(applyReviewEvents(next, "t1", [ev(4, { type: "comment.deleted", id: "c" })])).toBe(next)
    const sent = applyReviewEvents(next, "t1", [ev(5, { type: "review.decided", id: "r2", taskId: "t1", decision: "sent_back", note: "Redo" })])
    expect(sent[1]).toMatchObject({ decision: "sent_back", decisionNote: "Redo", decidedAt: 5 })
  })
})
