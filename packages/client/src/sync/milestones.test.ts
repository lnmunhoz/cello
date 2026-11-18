import type { Milestone, Status, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import type { BoardState } from "./applyEvents.ts"
import { milestoneGroups, milestonesOf, milestoneTasks, progressOf } from "./milestones.ts"

const status = (id: string, position: string, category: Status["category"], name = id): Status => ({
  id, workspaceId: "w1", name, category, position, color: "#999", hidden: false, createdAt: 1, updatedAt: 1,
})
const task = (id: string, statusId: string, milestoneId: string | null, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number: 1, key: id, title: id, description: "", statusId, priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], milestoneId, assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me",
  createdBySessionId: null, updatedByActorId: null, updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null,
  version: 1, createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})
const milestone = (id: string, position: string, extra: Partial<Milestone> = {}): Milestone => ({
  id, projectId: "p1", name: id.toUpperCase(), goal: "", targetDate: null, position, state: "open", closedAt: null, createdAt: 1, updatedAt: 1, ...extra,
})

const state: BoardState = {
  seq: 1, actors: {}, workspaces: {}, projects: {}, labels: {}, sessions: {}, agents: {}, reviews: {}, asks: {}, documents: {}, wakes: {}, testOutcomes: {},
  statuses: {
    todo: status("todo", "a0", "unstarted"),
    doing: status("doing", "a1", "started", "In Progress"),
    review: status("review", "a2", "started", "In Review"),
    done: status("done", "a3", "completed"),
  },
  milestones: {
    m3: milestone("m3", "a2"),
    m2: milestone("m2", "a1"),
    m1: milestone("m1", "a0", { state: "closed", closedAt: 10 }),
    m0: milestone("m0", "Z", { state: "closed", closedAt: 20 }),
    other: milestone("other", "a0", { projectId: "p2" }),
  },
  tasks: {
    a: task("a", "done", "m3"),
    b: task("b", "review", "m3"),
    c: task("c", "todo", "m3"),
    gone: task("gone", "todo", "m3", { archivedAt: 5 }),
    loose: task("loose", "doing", null),
    finished: task("finished", "done", null),
    elsewhere: task("elsewhere", "todo", null, { projectId: "p2" }),
  },
}

describe("milestone views (CEL-132)", () => {
  it("lists a project's open milestones in order and its closed ones, the latest closed first", () => {
    const { open, closed } = milestonesOf(state, "p1")
    expect(open.map((m) => m.id)).toEqual(["m2", "m3"])
    expect(closed.map((m) => m.id)).toEqual(["m0", "m1"])
  })

  it("counts a milestone's progress from its tasks on the board, archived ones left out", () => {
    expect(progressOf(state, "w1", "p1", "m3")).toMatchObject({ total: 3, done: 1, inReview: 1, todo: 1, percent: 33 })
  })

  it("with no milestone: the project's open tasks without one", () => {
    expect(milestoneTasks(state, "w1", "p1", null).map((t) => t.id)).toEqual(["loose"])
  })

  it("groups a milestone's tasks by status, in status order (a hidden Backlog first too), only the groups with a task", () => {
    const withBacklog: BoardState = {
      ...state,
      statuses: { ...state.statuses, backlog: { ...status("backlog", "0a", "backlog"), hidden: true } },
      tasks: { ...state.tasks, later: task("later", "backlog", "m3") },
    }
    expect(milestoneGroups(withBacklog, "w1", "p1", "m3", { needsInputColumn: false }).map((g) => [g.status.id, g.tasks.map((t) => t.id)])).toEqual([
      ["backlog", ["later"]],
      ["todo", ["c"]],
      ["review", ["b"]],
      ["done", ["a"]],
    ])
  })
})
