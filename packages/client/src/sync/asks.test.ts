import type { Ask, Project, Task } from "@cello/contract/entities"
import type { CelloEvent, EventBody } from "@cello/contract/events"
import { describe, expect, it } from "vitest"
import type { BoardState } from "./applyEvents.ts"
import { applyAskEvents, needsInputFold, needsInputQueue, openAskOf, questionCount } from "./asks.ts"

const project = (id: string, workspaceId = "w1", archivedAt: number | null = null): Project => ({
  id, workspaceId, name: id, key: id.toUpperCase(), color: "#000", description: "", repoPath: null, createdAt: 1, updatedAt: 1, archivedAt,
})
const task = (id: string, projectId = "p1", archivedAt: number | null = null): Task => ({
  id, projectId, number: 1, key: `CEL-${id}`, title: id, description: "", statusId: "input", priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me",
  createdBySessionId: null, updatedByActorId: null, updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt,
})
const ask = (id: string, taskId: string, createdAt: number): Ask => ({
  id, taskId, title: `Ask ${id}`, intro: "", questions: [{ id: "q1", prompt: "Which?", kind: "text", options: [] }], attachments: [],
  actorId: "agent", sessionId: "s1", author: { name: "Claude Code", session: "2fd0505c" }, state: "open", createdAt,
  answeredAt: null, answers: null, withdrawnAt: null, withdrawnBy: null,
})

const state: BoardState = {
  seq: 1, actors: {}, workspaces: {}, statuses: {}, labels: {}, sessions: {}, reviews: {}, documents: {},
  projects: { p1: project("p1"), p2: project("p2", "w2"), p3: project("p3", "w1", 5) },
  tasks: { t1: task("t1"), t2: task("t2"), t3: task("t3", "p2"), t4: task("t4", "p1", 9), t5: task("t5", "p3") },
  asks: { k1: ask("k1", "t1", 30), k2: ask("k2", "t2", 10), k3: ask("k3", "t3", 1), k4: ask("k4", "t4", 1), k5: ask("k5", "t5", 1) },
}

const ev = (seq: number, body: EventBody): CelloEvent =>
  ({ seq, ts: 100 + seq, commandId: "c", actorId: "human", sessionId: null, workspaceId: "w1", projectId: "p1", schemaVersion: 1, ...body }) as CelloEvent

describe("Needs input on the client", () => {
  it("queues the workspace's open asks, oldest first, leaving out archived tasks and projects", () => {
    expect(needsInputQueue(state, "w1").map((i) => [i.ask.id, i.task.id, i.project.id])).toEqual([["k2", "t2", "p1"], ["k1", "t1", "p1"]])
    expect(openAskOf(state, "t1")?.id).toBe("k1")
    expect(openAskOf(state, "t9")).toBeUndefined()
    expect(questionCount(ask("k", "t", 1))).toBe("1 question")
  })

  it("keeps a task's list current: a new ask, Lucas's answers, a withdrawal", () => {
    const first = ask("k1", "t1", 1)
    let list = applyAskEvents([first], "t1", [ev(2, { type: "ask.created", ask: ask("k2", "t1", 2) }), ev(3, { type: "ask.created", ask: ask("kx", "t9", 3) })])
    expect(list.map((a) => a.id)).toEqual(["k1", "k2"])
    list = applyAskEvents(list, "t1", [ev(4, { type: "ask.withdrawn", id: "k1", taskId: "t1", reason: "superseded" })])
    expect(list[0]).toMatchObject({ state: "superseded", withdrawnAt: 104, withdrawnBy: "human" })
    const answered = { ...ask("k2", "t1", 2), state: "answered" as const, answeredAt: 5, answers: { questions: [], note: "Ok", noteAttachments: [] } }
    list = applyAskEvents(list, "t1", [ev(5, { type: "ask.answered", ask: answered })])
    expect(list[1]).toEqual(answered)
    expect(applyAskEvents(list, "t1", [])).toBe(list)
  })
})

describe("folding the Needs input column (off by default, Lucas, Nov 15)", () => {
  const s = (id: string, name: string, category: string) => ({ id, name, category: category as "started" })
  const statuses = [s("todo", "Todo", "unstarted"), s("doing", "In Progress", "started"), s("input", "Needs input", "waiting"), s("review", "In Review", "started")]

  it("folds its tasks into the first started status while the column is off", () => {
    expect(needsInputFold(statuses, false)).toEqual({ from: "input", into: "doing" })
    expect(needsInputFold(statuses, true)).toBeNull()
    expect(needsInputFold(statuses.filter((x) => x.id !== "input"), false)).toBeNull()
  })
})
