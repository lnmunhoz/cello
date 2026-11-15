// Needs input on the client (CEL-47): the open asks waiting on Lucas, the Review page's first group,
// and a task's loaded list of asks kept current from the event stream.
import type { Ask, Project, Task } from "@cello/contract/entities"
import type { CelloEvent } from "@cello/contract/events"
import type { BoardState } from "./applyEvents.ts"

export interface AskItem {
  readonly task: Task
  readonly project: Project
  readonly ask: Ask
}

/** A task's open ask, if it has one. */
export const openAskOf = (state: BoardState, taskId: string): Ask | undefined =>
  Object.values(state.asks).find((a) => a.taskId === taskId)

/** Everything waiting on Lucas's answers in a workspace, oldest ask first. Archived tasks and projects are left out. */
export const needsInputQueue = (state: BoardState, workspaceId: string): AskItem[] =>
  Object.values(state.asks)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    .flatMap((ask) => {
      const task = state.tasks[ask.taskId]
      const project = task ? state.projects[task.projectId] : undefined
      if (!task || task.archivedAt !== null || !project || project.workspaceId !== workspaceId || project.archivedAt !== null) return []
      return [{ task, project, ask }]
    })

const CLOSED = { agent: "withdrawn", moved: "withdrawn", superseded: "superseded" } as const

/** A task's asks (from `ask.list`) kept current from the event stream. */
export const applyAskEvents = (asks: ReadonlyArray<Ask>, taskId: string, events: ReadonlyArray<CelloEvent>): ReadonlyArray<Ask> => {
  let next = asks
  for (const e of events) {
    if (e.type === "ask.created" && e.ask.taskId === taskId && !next.some((a) => a.id === e.ask.id)) {
      next = [...next, e.ask]
    } else if (e.type === "ask.answered" && e.ask.taskId === taskId) {
      next = next.map((a) => (a.id === e.ask.id ? e.ask : a))
    } else if (e.type === "ask.withdrawn" && e.taskId === taskId) {
      next = next.map((a) => (a.id === e.id ? { ...a, state: CLOSED[e.reason], withdrawnAt: e.ts, withdrawnBy: e.actorId } : a))
    }
  }
  return next
}

/** "3 questions". */
export const questionCount = (ask: Pick<Ask, "questions">): string =>
  `${ask.questions.length} question${ask.questions.length === 1 ? "" : "s"}`
