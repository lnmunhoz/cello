// What a status's category says about its tasks; one place, so every service reads it the same way.

/** The categories of finished statuses (Done, Canceled): a claim on their tasks no longer holds, and nobody asks on them. */
const CLOSED_CATEGORIES: ReadonlySet<string> = new Set(["completed", "canceled"])

/** Whether a status of this category is closed: its tasks are finished. */
export const isClosedCategory = (category: string): boolean => CLOSED_CATEGORIES.has(category)

/**
 * The categories `cello task list` shows by default: tasks to do, in progress or waiting on Lucas. Backlog
 * shows with --status Backlog. `other` (a category this build doesn't know, CEL-178; the database never
 * stores it) is active: its tasks are work in flight, and hiding them from the default list would lose them.
 */
const ACTIVE_CATEGORIES: ReadonlySet<string> = new Set(["unstarted", "started", "waiting", "other"])

/** Whether a status of this category holds tasks that are active: not Backlog, not finished. */
export const isActiveCategory = (category: string): boolean => ACTIVE_CATEGORIES.has(category)
