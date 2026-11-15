// The Review page's rules, kept pure: which row is open (it lives in the URL, `?open=CEL-12`), which
// opens after a decision, and the keys that move between rows.
import { formatTaskKey, parseTaskKey } from "@cello/shared/taskKey"

export interface ReviewSearch {
  /** The task whose packet is open; none: every row is collapsed. */
  readonly open?: string
}

export const parseReviewSearch = (search: Record<string, unknown>): ReviewSearch => {
  const task = typeof search["open"] === "string" ? parseTaskKey(search["open"]) : null
  return task ? { open: formatTaskKey(task.projectKey, task.number) } : {}
}

/** The row that opens once `decided` leaves the queue: the next one, else the one before, else none. */
export const nextAfterDecision = (keys: ReadonlyArray<string>, decided: string): string | undefined => {
  const at = keys.indexOf(decided)
  return at === -1 ? undefined : (keys[at + 1] ?? keys[at - 1])
}

const ROW_KEYS: Readonly<Record<string, string>> = { j: "ArrowDown", k: "ArrowUp" }

/** j and k move between rows as ↓ and ↑ do (for `nextRow`); other keys stay as they are. */
export const rowKey = (key: string): string => ROW_KEYS[key] ?? key
