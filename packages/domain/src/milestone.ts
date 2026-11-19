// Milestones (CEL-113): how far along one is, and the order they're listed in. Progress is computed,
// never stored: the milestone's tasks counted by their status's category. The server uses it for
// `cello context` and `cello milestone list`; the web app derives the same numbers from the tasks it
// already has, so a bar moves as cards move (phase 2).
import { isReviewStatus } from "./review.ts"
import { closeMatches } from "./words.ts"

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
  /** In any other started status (In Progress), waiting on the human (Needs input), or in a category this build doesn't know. */
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
      // A category a newer server added (CEL-178): its tasks are work in flight, so they stay in the total.
      case "other":
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

/** What's left besides Done, in words: "1 in review", "2 in progress", "1 to do", "1 in Backlog" (only the ones there are). */
export const progressParts = (p: MilestoneProgress): string[] => [
  ...(p.inReview ? [`${p.inReview} in review`] : []),
  ...(p.inProgress ? [`${p.inProgress} in progress`] : []),
  ...(p.todo ? [`${p.todo} to do`] : []),
  ...(p.backlog ? [`${p.backlog} in Backlog`] : []),
]

/** The order milestones are listed in: their position (set by the human, M2 before M3), then name. */
export const byPosition = (a: { readonly position: string; readonly name: string }, b: { readonly position: string; readonly name: string }): number =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : compareMilestoneNames(a.name, b.name)

/** Names in reading order, numbers by value and case ignored: M2 before M10. */
export const compareMilestoneNames = (a: string, b: string): number =>
  a.localeCompare(b, "en", { numeric: true, sensitivity: "base" })

/**
 * A project's milestone by name, in any case, spaces trimmed on both sides; `none` means no milestone
 * where `allowNone`. Anything else is a `problem`: one sentence (no closing period, so a caller can end
 * it) with close matches, the project's names and how to make it. The server's `task list --milestone`
 * and `milestone get` and the CLI's `--milestone` all match with this.
 */
export const findMilestone = <M extends { readonly name: string }>(
  milestones: ReadonlyArray<M>,
  name: string,
  options: { readonly projectKey: string; readonly allowNone: boolean },
): { readonly found: M | null } | { readonly problem: string } => {
  const wanted = name.trim().toLowerCase()
  if (options.allowNone && wanted === "none") return { found: null }
  const found = milestones.find((m) => m.name.trim().toLowerCase() === wanted)
  if (found) return { found }
  const names = milestones.map((m) => m.name.trim())
  const close = closeMatches(name.trim(), names)
  return {
    problem: `No milestone named "${name.trim()}" in ${options.projectKey}${close.length ? ` (did you mean ${close.length < 2 ? close.join("") : `${close.slice(0, -1).join(", ")} or ${close.at(-1)}`}?)` : ""}. ` +
      `Milestones: ${names.join(", ") || "none yet"}${options.allowNone && names.length ? " (or none)" : ""}. ` +
      `Nothing was changed; \`cello milestone create ${name.trim()}\` makes it`,
  }
}

// The Milestones page and the board's Group by: Milestone (CEL-132).

const DAY_MS = 86_400_000

/** A `YYYY-MM-DD` day as a count of days, by the calendar (UTC), so a daylight-saving change doesn't shift it. */
const dayNumber = (day: string): number => {
  const [y, m, d] = day.split("-").map(Number)
  return Math.round(Date.UTC(y!, m! - 1, d!) / DAY_MS)
}

/** The local calendar day of a moment, as `YYYY-MM-DD`: what "today" is for a due date. */
export const localDay = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** "3 days left", "due today" or "4 days late" (`late`, shown in red), from `today` to the target date. */
export const dueText = (targetDate: string, today: string): { readonly text: string; readonly late: boolean } => {
  const days = dayNumber(targetDate) - dayNumber(today)
  if (days === 0) return { text: "due today", late: false }
  const n = Math.abs(days)
  const unit = n === 1 ? "day" : "days"
  return days > 0 ? { text: `${n} ${unit} left`, late: false } : { text: `${n} ${unit} late`, late: true }
}

/**
 * "All done: close M3?": an open milestone whose every task that counts is Done (Canceled ones don't
 * count; Backlog ones do). Closing stays the human's, so it's only a suggestion; an empty milestone gets none.
 */
export const closeSuggested = (milestone: { readonly state: string }, progress: MilestoneProgress): boolean =>
  milestone.state === "open" && progress.total > 0 && progress.done === progress.total

type ClosedLike = { readonly state: string; readonly closedAt: number | null }

/**
 * Whether a task of a closed milestone could have moved out of Done since the close: it isn't Done or
 * Canceled now and was changed after the close. Only such a task's history is worth reading
 * (reopenedAfterClose); for every other task the answer is already no.
 */
export const mightHaveReopened = (task: { readonly updatedAt: number }, milestone: ClosedLike, category: string): boolean =>
  milestone.state === "closed" && milestone.closedAt !== null && category !== "completed" && category !== "canceled" && task.updatedAt > milestone.closedAt

/**
 * "reopened after M3 closed": a task of a closed milestone whose history has a move out of a Done status
 * after the close, and that isn't Done or Canceled now. A task that was never Done and was only edited
 * after the close isn't. A closed milestone never reopens by itself: it stays closed, and the task's row
 * says so instead.
 */
export const reopenedAfterClose = (
  milestone: ClosedLike,
  category: string,
  history: ReadonlyArray<{ readonly type: string; readonly ts: number; readonly from?: { readonly statusId: string }; readonly to?: { readonly statusId: string } }>,
  categoryOf: (statusId: string) => string | undefined,
): boolean => {
  if (milestone.state !== "closed" || milestone.closedAt === null || category === "completed" || category === "canceled") return false
  const closedAt = milestone.closedAt
  return history.some((e) =>
    e.type === "task.moved" && e.ts > closedAt && e.from !== undefined && e.to !== undefined &&
    categoryOf(e.from.statusId) === "completed" && categoryOf(e.to.statusId) !== "completed"
  )
}

/** The Milestones page's No milestone line: tasks without one that are still open (not Done, Canceled or archived). */
export const openWithoutMilestone = <T extends TaskLike & { readonly milestoneId?: string | null }>(
  tasks: ReadonlyArray<T>,
  statuses: ReadonlyArray<StatusLike>,
): T[] => {
  const byId = new Map(statuses.map((s) => [s.id, s]))
  return tasks.filter((t) => {
    if (t.archivedAt !== null || (t.milestoneId ?? null) !== null) return false
    const category = byId.get(t.statusId)?.category
    return category !== undefined && category !== "completed" && category !== "canceled"
  })
}

type InMilestone = { readonly milestoneId?: string | null }

export interface MilestoneLane<M> {
  /** The milestone's id, or `none`. */
  readonly key: string
  readonly milestone: M | null
  /** Whether a task sits in this lane. */
  readonly has: (task: InMilestone) => boolean
}

/**
 * The board's swimlanes under Group by: Milestone (pass one project's milestones and the tasks shown):
 * the open milestones in order, then the closed ones a shown task is still in, then No milestone, last
 * and always there so a card can be dragged out of a milestone. A task in a milestone missing from the
 * list counts as having none.
 */
export const milestoneLanes = <M extends { readonly id: string; readonly name: string; readonly position: string; readonly state: string }>(
  milestones: ReadonlyArray<M>,
  tasks: ReadonlyArray<InMilestone>,
): MilestoneLane<M>[] => {
  const known = new Set(milestones.map((m) => m.id))
  const used = new Set(tasks.map((t) => t.milestoneId ?? null))
  const sorted = [...milestones].sort(byPosition)
  const ordered = [...sorted.filter((m) => m.state === "open"), ...sorted.filter((m) => m.state !== "open" && used.has(m.id))]
  return [
    ...ordered.map((m) => ({ key: m.id, milestone: m, has: (t: InMilestone) => t.milestoneId === m.id })),
    { key: "none", milestone: null, has: (t: InMilestone) => t.milestoneId === undefined || t.milestoneId === null || !known.has(t.milestoneId) },
  ]
}
