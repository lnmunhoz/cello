// A task the board doesn't hold (another workspace's), as `task.get` reads it, made into a board of its
// own: the hover card on a task link (CEL-142) then shows it with the same pieces as a task on the board.
import type { TaskDetail } from "@cello/contract/views"
import { type BoardState, fromSnapshot } from "./applyEvents.ts"

/** A board with just `detail`'s task, its project's names, and what waits on Lucas (its open packet and ask), as the board keeps them. */
export const boardOfTaskDetail = (detail: TaskDetail): BoardState =>
  fromSnapshot({
    seq: 0,
    actors: detail.actors,
    workspaces: [],
    projects: [detail.project],
    statuses: detail.statuses,
    labels: detail.labels,
    milestones: detail.milestones,
    tasks: [detail.task],
    sessions: detail.sessions,
    agents: detail.agents,
    reviews: detail.reviews.filter((r) => r.decidedAt === null),
    asks: detail.asks.filter((a) => a.state === "open"),
    documents: [],
  })
