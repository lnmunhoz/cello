// The order cards show in inside a board column or a list group, picked in the Display popover.
import type { Task } from "@cello/contract/entities"
import { comparePosition } from "./selectors.ts"

/** `manual` is the drag order (each task's position); the others sort by a field and ignore it. */
export type Ordering = "manual" | "newest" | "oldest" | "priority" | "due" | "updated"

export const ORDERINGS: ReadonlyArray<Ordering> = ["manual", "newest", "oldest", "priority", "due", "updated"]

export const ORDERING_LABELS: Readonly<Record<Ordering, string>> = {
  manual: "Manual",
  newest: "Newest first",
  oldest: "Oldest first",
  priority: "Priority",
  due: "Due date",
  updated: "Last updated",
}

/** A known ordering, or null for anything else (a hand-edited URL, an old saved value). */
export const parseOrdering = (value: unknown): Ordering | null =>
  typeof value === "string" && (ORDERINGS as ReadonlyArray<string>).includes(value) ? (value as Ordering) : null

type Compare = (a: Task, b: Task) => number

/** Urgent (1) first, then high, medium, low; no priority (0) last. */
const priorityRank = (t: Task) => (t.priority === 0 ? 5 : t.priority)

/** Due dates are `YYYY-MM-DD`, so they sort as strings; no due date sorts after every date. */
const dueRank = (t: Task) => t.dueDate ?? "9999-99-99"

/** The project numbers tasks in the order they're made; a task still being created (number 0) is the latest. */
const madeRank = (t: Task) => (t.number === 0 ? Number.MAX_SAFE_INTEGER : t.number)

/** When it was made, and the number for tasks made in the same millisecond. */
const oldestFirst: Compare = (a, b) => a.createdAt - b.createdAt || madeRank(a) - madeRank(b)

const compares: Readonly<Record<Ordering, Compare>> = {
  manual: () => 0,
  newest: (a, b) => oldestFirst(b, a),
  oldest: oldestFirst,
  priority: (a, b) => priorityRank(a) - priorityRank(b),
  due: (a, b) => (dueRank(a) < dueRank(b) ? -1 : dueRank(a) > dueRank(b) ? 1 : 0),
  updated: (a, b) => b.updatedAt - a.updatedAt,
}

/** The tasks in `ordering`, as a new array. Ties keep the drag order, so equal cards never swap places. */
export const orderTasks = (tasks: ReadonlyArray<Task>, ordering: Ordering): Task[] => {
  const compare = compares[ordering]
  return [...tasks].sort((a, b) => compare(a, b) || comparePosition(a, b))
}
