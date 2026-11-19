// A decision in its undo window survives the page (CEL-191). Lucas clicked Approve: if the tab closes or
// reloads before the window ends, the decision is not lost. It is written down when the window opens (a
// small record per task, in localStorage, kept on this device like the rest of the Review page's state),
// and removed when it was undone, answered by the server (taken or refused), or overtaken. What is still
// written the next time the app loads is sent then, at once: the window has passed. These are the
// record's rules, kept pure; the reading, writing and sending are in useRecoverDecisions.ts and
// ReviewActions.tsx.
import { type Decision, decisionStillOpen, type Standing } from "./queue.ts"

export const PENDING_PREFIX = "cello:review-pending:"

export const pendingStorageKey = (taskKey: string): string => `${PENDING_PREFIX}${taskKey}`

/** What was clicked, with everything the command needs, as it stood at the click. */
export interface PendingDecision {
  readonly taskId: string
  readonly taskKey: string
  /** The packet it was made on (null: a task in In Review without one). */
  readonly reviewId: string | null
  readonly decision: Decision
  /** The note the decision sends: the box's text, trimmed (null: none). */
  readonly note: string | null
  /** The screenshots pasted into the box. */
  readonly attachmentIds: ReadonlyArray<string>
  readonly clickedAt: number
}

const VERSION = 1

export const serializePending = (record: PendingDecision): string => JSON.stringify({ v: VERSION, ...record })

const isText = (value: unknown): value is string => typeof value === "string" && value !== ""

/**
 * The record in `text`, or null when there isn't a sound one: not JSON, not an object, another version,
 * a field missing or of the wrong kind. Only the fields it knows are read, so nothing else stored under
 * the key is ever sent.
 */
export const parsePending = (text: string | null): PendingDecision | null => {
  if (text === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r["v"] !== VERSION) return null
  const { taskId, taskKey, reviewId, decision, note, attachmentIds, clickedAt } = r
  if (!isText(taskId) || !isText(taskKey)) return null
  if (reviewId !== null && !isText(reviewId)) return null
  if (decision !== "approved" && decision !== "sent_back") return null
  if (note !== null && typeof note !== "string") return null
  if (decision === "sent_back" && (note === null || note.trim() === "")) return null
  if (!Array.isArray(attachmentIds) || !attachmentIds.every(isText)) return null
  if (typeof clickedAt !== "number" || !Number.isFinite(clickedAt)) return null
  return { taskId, taskKey, reviewId, decision, note, attachmentIds: [...attachmentIds], clickedAt }
}

/** A recorded decision older than this is dropped on load, and said so: nobody means last week's approval. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000

export type Verdict =
  /** Send it now. */
  | { readonly kind: "send" }
  /** Don't: `decided` (the packet was decided or replaced meanwhile) or `old`. The record is removed and Lucas is told. */
  | { readonly kind: "drop"; readonly reason: "decided" | "old" }
  /** The board doesn't know the task (another workspace, deleted): neither sent nor dropped; a later load looks again, and age ends it. */
  | { readonly kind: "later" }

/**
 * What to do with a record found on load: `standing` is what the board says now about its task (null:
 * the board doesn't have it). Too old is dropped first; then the packet it was made on has to still be
 * the one waiting (`decisionStillOpen`), else the decision was already made, by the page's own last-moment
 * send or elsewhere, and sending it again would be refused or decide something new.
 */
export const judgePending = (record: PendingDecision, now: number, standing: Standing | null): Verdict => {
  if (now - record.clickedAt > MAX_AGE_MS) return { kind: "drop", reason: "old" }
  if (standing === null) return { kind: "later" }
  return decisionStillOpen(record.reviewId, standing) ? { kind: "send" } : { kind: "drop", reason: "decided" }
}
