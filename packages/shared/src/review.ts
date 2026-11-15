// Where review packets move a task: the server applies these, the web app uses the same names to
// find the In Review column.
import { isNeedsInputStatus } from "./ask.ts"

interface StatusLike {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly position: string
}

export const REVIEW_STATUS_NAME = "In Review"

export const isReviewStatus = (name: string): boolean => name.trim().toLowerCase() === REVIEW_STATUS_NAME.toLowerCase()

/**
 * Whether a task in this status can have a packet waiting on Lucas: In Review, or Needs input when the
 * agent asked from In Review (CEL-47). Anywhere else an open packet is stale (CEL-71): left from before
 * moves withdrew packets, it counts as no packet, and the task's next move withdraws it.
 */
export const holdsPacket = (status: { readonly name: string; readonly category: string }): boolean =>
  isReviewStatus(status.name) || isNeedsInputStatus(status)

const sorted = <S extends StatusLike>(statuses: ReadonlyArray<S>): S[] =>
  [...statuses].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))

/** Where a submitted review moves the task: the first status named In Review, else the first started status after the current one. */
export const reviewTarget = <S extends StatusLike>(statuses: ReadonlyArray<S>, currentStatusId: string): S | null => {
  const ordered = sorted(statuses)
  const named = ordered.find((s) => isReviewStatus(s.name))
  if (named) return named
  const current = ordered.find((s) => s.id === currentStatusId)
  return ordered.find((s) => s.category === "started" && (current === undefined || s.position > current.position)) ?? null
}

/** Where an approved task goes: the first completed status. */
export const approveTarget = <S extends StatusLike>(statuses: ReadonlyArray<S>): S | null =>
  sorted(statuses).find((s) => s.category === "completed") ?? null

/**
 * The status stages live in (CEL-35): the first started one by position (In Progress), where a claim
 * puts a task. `cello task stage` works only there, and only its column splits into lanes.
 */
export const stageStatus = <S extends StatusLike>(statuses: ReadonlyArray<S>): S | null =>
  sorted(statuses).find((s) => s.category === "started") ?? null

/** Where a task sent back goes: the first started status, back to work. */
export const sendBackTarget = stageStatus
