import type { Attachment, Project, Review, Status, Task } from "@cello/contract/entities"
import type { CelloEvent, EventBody } from "@cello/contract/events"
import { describe, expect, it } from "vitest"
import type { BoardState } from "./applyEvents.ts"
import { applyReviewEvents, attachmentUrl, evidenceInOrder, evidenceOpen, evidenceTarget, firstEvidence, openReviewOf, posterUrl, reviewQueue, thumbnailOf } from "./reviews.ts"

const status = (id: string, name: string, category: Status["category"], position: string): Status => ({
  id, workspaceId: "w1", name, category, position, color: "#999", hidden: false, createdAt: 1, updatedAt: 1,
})
const project = (id: string, key: string, workspaceId = "w1"): Project => ({
  id, workspaceId, name: key, key, color: "#000", description: "", repoPath: null, createdAt: 1, updatedAt: 1, archivedAt: null,
})
const task = (id: string, statusId: string, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number: 1, key: `CEL-${id}`, title: id, description: "", statusId, priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me",
  createdBySessionId: null, updatedByActorId: null, updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})
const attachment = (id: string, kind: Attachment["kind"], extra: Partial<Attachment> = {}): Attachment => ({
  id, taskId: "t1", reviewId: "r1", askId: null, kind, name: `${id}.bin`, url: null, caption: "", mime: null, bytes: 10, hasPoster: false,
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
    t4: task("t4", "done"), // moved on before CEL-71 withdrew packets: its packet is still undecided
    t6: task("t6", "review"),
    t5: task("t5", "doing"),
    gone: task("gone", "review", { archivedAt: 5 }),
    far: task("far", "review", { projectId: "p9" }),
  },
  sessions: {}, agents: {},
  reviews: {
    r1: review("r1", "t1", 30),
    r2: review("r2", "t2", 10),
    r4: review("r4", "t4", 20),
    r6: review("r6", "t6", 25),
    rg: review("rg", "gone", 5),
  },
  asks: {},
  documents: {},
}

const ev = (seq: number, body: EventBody): CelloEvent =>
  ({ seq, ts: seq, commandId: `c${seq}`, actorId: "me", sessionId: null, workspaceId: "w1", projectId: "p1", schemaVersion: 1, ...body }) as CelloEvent

describe("the review queue", () => {
  it("lists every task waiting on Lucas across the workspace's projects, oldest packet first, then tasks without one", () => {
    const queue = reviewQueue(state, "w1")
    expect(queue.map((i) => [i.task.id, i.review?.id ?? null, i.project.key])).toEqual([
      ["t2", "r2", "ZED"],
      ["t6", "r6", "CEL"],
      ["t1", "r1", "CEL"],
      ["t3", null, "CEL"],
    ])
  })

  // CEL-71: CEL-52 went back to In Progress by a plain move while its packet stayed undecided, and the
  // Review page kept listing it. A packet is listed only while its task is in In Review.
  it("leaves out a packet whose task has moved on, though the packet was never decided", () => {
    expect(reviewQueue(state, "w1").map((i) => i.task.id)).not.toContain("t4")
    const moved = { ...state, tasks: { ...state.tasks, t1: task("t1", "doing") } }
    expect(reviewQueue(moved, "w1").map((i) => i.task.id)).toEqual(["t2", "t6", "t3"])
  })

  it("leaves out a task waiting on Lucas's answers: the Needs input group shows it first", () => {
    const ask = {
      id: "k1", taskId: "t6", title: "Which?", intro: "", questions: [], attachments: [], actorId: "agent", sessionId: "s1",
      author: { name: "Claude Code", session: "2fd0505c" }, state: "open" as const, createdAt: 1, answeredAt: null, answers: null,
      withdrawnAt: null, withdrawnBy: null,
    }
    expect(reviewQueue({ ...state, asks: { k1: ask } }, "w1").map((i) => i.task.id)).toEqual(["t2", "t1", "t3"])
  })

  it("finds a task's open review", () => {
    expect(openReviewOf(state, "t1")?.id).toBe("r1")
    expect(openReviewOf(state, "t5")).toBeUndefined()
  })

  // CEL-71: a packet left open before the fix, on a task that moved on, isn't waiting: no badge, no
  // pinned packet with Approve, no "waiting: review" match. It is while the task waits in Needs input.
  it("an open review counts only while its task is in In Review or Needs input", () => {
    expect(openReviewOf(state, "t4")).toBeUndefined()
    const asking = {
      ...state,
      statuses: { ...state.statuses, input: status("input", "Needs input", "waiting", "a25") },
      tasks: { ...state.tasks, t4: task("t4", "input") },
    }
    expect(openReviewOf(asking, "t4")?.id).toBe("r4")
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

  it("a Review row prefers the first screenshot (a poster can be the video's blank first frame), else a poster", () => {
    const shot = attachment("s1", "image")
    const video = attachment("v1", "video", { hasPoster: true })
    expect(thumbnailOf(review("r", "t", 1, [video, attachment("s0", "image"), shot]), "screenshot")).toBe("/attachments/s0")
    expect(thumbnailOf(review("r", "t", 1, [attachment("l", "link"), video]), "screenshot")).toBe("/attachments/v1/poster")
    expect(thumbnailOf(review("r", "t", 1, [attachment("f", "file")]), "screenshot")).toBeNull()
  })

  it("is shown videos first, then screenshots, files and links, each kind in the order it was attached", () => {
    const list = [attachment("l1", "link"), attachment("f1", "file"), attachment("s1", "image"), attachment("v1", "video"), attachment("s2", "image")]
    expect(evidenceInOrder(list).map((a) => a.id)).toEqual(["v1", "s1", "s2", "f1", "l1"])
  })

  it("a card's badge opens the first piece of evidence in that order", () => {
    expect(firstEvidence(review("r", "t", 1, [attachment("l1", "link"), attachment("s1", "image")]))?.id).toBe("s1")
    expect(firstEvidence(review("r", "t", 1, []))).toBeUndefined()
  })

  it("what the viewer opens for each piece: the served file or the link, its caption or name, and whether it's an image or a video", () => {
    expect(evidenceTarget(attachment("s1", "image", { caption: "The board" }))).toEqual({ url: "/attachments/s1", title: "The board", kind: "image" })
    expect(evidenceTarget(attachment("v1", "video", { name: "flow.mp4" }))).toEqual({ url: "/attachments/v1", title: "flow.mp4", kind: "video" })
    expect(evidenceTarget(attachment("f1", "file", { name: "test-output.txt", mime: "text/plain", caption: "Test output" }))).toEqual({ url: "/attachments/f1", title: "Test output", kind: "text", name: "test-output.txt" })
    expect(evidenceTarget(attachment("f2", "file", { name: "shot.webp", mime: "image/webp" }))).toEqual({ url: "/attachments/f2", title: "shot.webp", kind: "image" })
    const pr = attachment("l1", "link", { url: "https://github.com/lnmunhoz/cello/pull/10", name: "https://github.com/lnmunhoz/cello/pull/10" })
    expect(evidenceTarget(pr)).toEqual({ url: "https://github.com/lnmunhoz/cello/pull/10", title: "github.com/lnmunhoz/cello/pull/10" })
    expect(evidenceTarget({ ...pr, caption: "The PR" })?.title).toBe("The PR")
    expect(evidenceTarget(attachment("l2", "link"))).toBeNull()
  })

  it("a screenshot opens in the image modal, at its place among the packet's screenshots (images attached as files too)", () => {
    const shot1 = attachment("s1", "image", { caption: "The board" })
    const shot2 = attachment("s2", "image", { name: "dark.png" })
    const webp = attachment("f2", "file", { name: "shot.webp", mime: "image/webp" })
    const packet = [attachment("l1", "link", { url: "https://example.com" }), webp, shot1, attachment("v1", "video"), shot2, attachment("f1", "file", { mime: "text/plain" })]
    expect(evidenceOpen(shot2, packet)).toEqual({
      in: "modal",
      index: 1,
      images: [
        { url: "/attachments/s1", title: "The board", name: "s1.bin" },
        { url: "/attachments/s2", title: "dark.png", name: "dark.png" },
        { url: "/attachments/f2", title: "shot.webp", name: "shot.webp" },
      ],
    })
    expect(evidenceOpen(webp, packet)).toMatchObject({ in: "modal", index: 2 })
    // On its own (a packet the caller doesn't have): the only image.
    expect(evidenceOpen(shot1, [])).toMatchObject({ in: "modal", index: 0, images: [{ url: "/attachments/s1" }] })
  })

  it("a video, a text file and a link open beside the board (a text file in the side panel's text view, CEL-60)", () => {
    const pr = attachment("l1", "link", { url: "https://github.com/lnmunhoz/cello/pull/10", caption: "The PR" })
    const video = attachment("v1", "video", { caption: "The whole flow" })
    const log = attachment("f1", "file", { name: "test-output.txt", mime: "text/plain" })
    const packet = [pr, video, log, attachment("s1", "image")]
    expect(evidenceOpen(pr, packet)).toEqual({ in: "panel", target: { url: "https://github.com/lnmunhoz/cello/pull/10", title: "The PR" } })
    expect(evidenceOpen(video, packet)).toEqual({ in: "panel", target: { url: "/attachments/v1", title: "The whole flow", kind: "video" } })
    expect(evidenceOpen(log, packet)).toEqual({ in: "panel", target: { url: "/attachments/f1", title: "test-output.txt", kind: "text", name: "test-output.txt" } })
    expect(evidenceOpen(attachment("l2", "link"), packet)).toBeNull()
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

  it("a packet withdrawn by a move closes as withdrawn (CEL-71)", () => {
    const next = applyReviewEvents([review("r1", "t1", 1)], "t1", [ev(6, { type: "review.withdrawn", id: "r1", taskId: "t1", to: "doing" })])
    expect(next[0]).toMatchObject({ decision: "withdrawn", decisionNote: null, decidedAt: 6 })
  })
})
