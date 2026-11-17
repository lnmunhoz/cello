import type { Ask, Project, Review, Status, Task } from "@cello/contract/entities"
import type { TaskDetail } from "@cello/contract/views"
import { describe, expect, it } from "vitest"
import { openAskOf } from "./asks.ts"
import { openReviewOf } from "./reviews.ts"
import { taskOfKey } from "./selectors.ts"
import { boardOfTaskDetail } from "./taskDetail.ts"

const project: Project = {
  id: "p9", workspaceId: "w2", name: "Thai Lookup", key: "THAI", color: "#000", description: "", repoPath: null, mergeAfterApproval: false, createdAt: 1, updatedAt: 1, archivedAt: null,
}
const review: Status = { id: "review", workspaceId: "w2", name: "In Review", category: "started", position: "a3", color: "#f2c94c", hidden: false, createdAt: 1, updatedAt: 1 }
const task: Task = {
  id: "t96", projectId: "p9", number: 96, key: "THAI-96", title: "Show baht prices", description: "", statusId: "review", priority: 2, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me", createdBySessionId: null,
  updatedByActorId: null, updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null,
}
const packet = (id: string, decidedAt: number | null): Review => ({
  id, taskId: "t96", summary: "", steps: [], attachments: [], actorId: "agent", sessionId: null, author: { name: "Claude Code", session: null },
  createdAt: 1, decidedAt, decision: decidedAt === null ? null : "sent_back", decisionNote: null,
})
const ask = (id: string, state: Ask["state"]): Ask => ({
  id, taskId: "t96", title: `Ask ${id}`, intro: "", questions: [], attachments: [], actorId: "agent", sessionId: null,
  author: { name: "Claude Code", session: null }, state, createdAt: 1, answeredAt: null, answers: null, withdrawnAt: null, withdrawnBy: null,
})

const detail: TaskDetail = {
  project,
  statuses: [review],
  labels: [],
  milestones: [],
  actors: [],
  sessions: [],
  agents: [],
  task,
  comments: [],
  reviews: [packet("r1", 5), packet("r2", null)],
  asks: [ask("a1", "answered"), ask("a2", "open")],
  documents: [],
  history: [],
}

// A task link to a task of another workspace (CEL-142): the board doesn't hold it, so its hover card
// reads `task.get` and shows it with the same pieces as a task the board holds.
describe("boardOfTaskDetail", () => {
  const board = boardOfTaskDetail(detail)

  it("holds the task, findable by its key, with its project and status", () => {
    expect(taskOfKey(board, "THAI-96")).toEqual(task)
    expect(board.projects["p9"]).toEqual(project)
    expect(board.statuses["review"]).toEqual(review)
  })

  it("keeps only what waits on Lucas, as the board does: the open packet and the open ask", () => {
    expect(Object.keys(board.reviews)).toEqual(["r2"])
    expect(openReviewOf(board, "t96")?.id).toBe("r2")
    expect(Object.keys(board.asks)).toEqual(["a2"])
    expect(openAskOf(board, "t96")?.id).toBe("a2")
  })
})
