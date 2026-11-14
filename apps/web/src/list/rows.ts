// The list layout's folding and keyboard rules, kept pure so they can be tested without a browser.
import type { ListGroup } from "@cello/client/sync/list"

/**
 * Whether a group hides its rows. What you chose wins; otherwise hidden statuses start folded,
 * unless the task open in the panel is in one.
 */
export const isCollapsed = (group: ListGroup, chosen: Readonly<Record<string, boolean>>, openTaskId: string | null): boolean =>
  chosen[group.status.id] ?? (group.status.hidden && !group.tasks.some((t) => t.id === openTaskId))

/** The rows the arrow keys move between, top to bottom: tasks in open groups, minus ones still being created. */
export const rowOrder = (groups: ReadonlyArray<ListGroup>, collapsed: (group: ListGroup) => boolean): string[] =>
  groups.filter((g) => !collapsed(g)).flatMap((g) => g.tasks.filter((t) => t.number > 0).map((t) => t.id))

/** Where a key moves the row focus: ↓ and ↑ step and stop at the ends, Home and End jump. Null for any other key. */
export const nextRow = (rows: ReadonlyArray<string>, current: string | null, key: string): string | null => {
  if (rows.length === 0) return null
  const at = current === null ? -1 : rows.indexOf(current)
  const last = rows.length - 1
  switch (key) {
    case "ArrowDown":
      return rows[at === -1 ? 0 : Math.min(at + 1, last)]!
    case "ArrowUp":
      return rows[at === -1 ? last : Math.max(at - 1, 0)]!
    case "Home":
      return rows[0]!
    case "End":
      return rows[last]!
    default:
      return null
  }
}

/** How many characters the key column holds: the longest key, and never less than a two-digit `CEL-12`. */
export const keyChars = (groups: ReadonlyArray<ListGroup>): number =>
  Math.max(6, ...groups.flatMap((g) => g.tasks.map((t) => t.key.length)))
