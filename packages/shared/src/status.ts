// What a status's category says about its tasks; one place, so every service reads it the same way.

/** The categories of finished statuses (Done, Canceled): a claim on their tasks no longer holds, and nobody asks on them. */
const CLOSED_CATEGORIES: ReadonlySet<string> = new Set(["completed", "canceled"])

/** Whether a status of this category is closed: its tasks are finished. */
export const isClosedCategory = (category: string): boolean => CLOSED_CATEGORIES.has(category)
