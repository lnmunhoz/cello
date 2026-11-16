// Milestones (CEL-113): how far along one is, and the order they're listed in. Progress is computed,
// never stored: the milestone's tasks counted by their status's category. The server uses it for
// `cello context` and `cello milestone list`; the web app derives the same numbers from the tasks it
// already has, so a bar moves as cards move (phase 2).
import { isReviewStatus } from "./review.ts"

interface StatusLike {
  readonly id: string
  readonly name: string
  readonly category: string
}

interface TaskLike {
  readonly statusId: string
  readonly archivedAt: number | null
}

export interface MilestoneProgress {
  /** Every task that counts: all but Canceled. Backlog is in it (Lucas: the bar counts every task, Backlog as a lighter tail). */
  readonly total: number
  /** In a completed status (Done). */
  readonly done: number
  /** In a started status named In Review. */
  readonly inReview: number
  /** In any other started status (In Progress), or waiting on the human (Needs input). */
  readonly inProgress: number
  /** Not started (Todo). */
  readonly todo: number
  /** In Backlog: counted in the total, shown apart since it isn't committed yet. */
  readonly backlog: number
  /** Canceled: left out of the total. */
  readonly canceled: number
  /** Done out of the total, rounded; 100 only when every task that counts is done, 0 for an empty milestone. */
  readonly percent: number
}

/**
 * The progress of a milestone's tasks (pass only its tasks). Archived tasks don't count, nor do tasks
 * in a status missing from `statuses`.
 */
export const milestoneProgress = (tasks: ReadonlyArray<TaskLike>, statuses: ReadonlyArray<StatusLike>): MilestoneProgress => {
  const byId = new Map(statuses.map((s) => [s.id, s]))
  let done = 0
  let inReview = 0
  let inProgress = 0
  let todo = 0
  let backlog = 0
  let canceled = 0
  for (const task of tasks) {
    if (task.archivedAt !== null) continue
    const status = byId.get(task.statusId)
    if (!status) continue
    switch (status.category) {
      case "completed":
        done++
        break
      case "canceled":
        canceled++
        break
      case "backlog":
        backlog++
        break
      case "unstarted":
        todo++
        break
      case "started":
        if (isReviewStatus(status.name)) inReview++
        else inProgress++
        break
      case "waiting":
        inProgress++
        break
    }
  }
  const total = done + inReview + inProgress + todo + backlog
  const rounded = total === 0 ? 0 : Math.round((done / total) * 100)
  const percent = done < total ? Math.min(rounded, 99) : rounded
  return { total, done, inReview, inProgress, todo, backlog, canceled, percent }
}

/** "6 of 11 done · 55%"; an empty milestone is "0 of 0 done". */
export const progressText = (p: MilestoneProgress): string =>
  p.total === 0 ? "0 of 0 done" : `${p.done} of ${p.total} done · ${p.percent}%`

/** The order milestones are listed in: their position (set by the human, M2 before M3), then name. */
export const byPosition = (a: { readonly position: string; readonly name: string }, b: { readonly position: string; readonly name: string }): number =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : compareMilestoneNames(a.name, b.name)

/** Names in reading order, numbers by value and case ignored: M2 before M10. */
export const compareMilestoneNames = (a: string, b: string): number =>
  a.localeCompare(b, "en", { numeric: true, sensitivity: "base" })
