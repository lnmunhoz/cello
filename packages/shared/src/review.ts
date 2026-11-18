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

/**
 * Whether a task was approved and waits for its agent to merge it (CEL-143): in a project that merges
 * after approval, Approve leaves the task in In Review and sets its stage (Approved · merging), and only
 * Approve puts a stage there. The agent's `cello task done` then moves it to Done. Not on the Review page:
 * it waits on the agent, not on Lucas.
 *
 * The invariant (a stage in In Review means approved) holds because every other way a stage meets In
 * Review clears it, and nothing clears it while the task waits:
 * - a move into or out of In Review clears the stage (TaskService.moveIn, `stageCarries`: only In
 *   Progress ↔ Needs input keeps it), so submitting, Send back, `cello task done` and any drag clear it
 * - `cello task stage --clear` on a waiting task is refused (TaskService.setStage), and `merging`
 *   anywhere else is too
 * - `cello task ask` on a waiting task is refused (AskService), since its trip through Needs input would
 *   clear the stage and lose the approval
 */
export const awaitsMerge = (task: { readonly stage: string | null }, status: { readonly name: string } | undefined): boolean =>
  status !== undefined && isReviewStatus(status.name) && task.stage !== null

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

/** What a reviewer's reply concluded (CEL-160): `fix_first` needs changes, `ask` is a question for the human. */
export type ReviewVerdict = "merge" | "fix_first" | "ask"

/** Reviewers: the agent types whose last reply leads with a verdict (`cello-code-reviewer`, `cello:reviewer`, `cello-data-reviewer`). */
export const isReviewerType = (agentType: string | null | undefined): boolean => agentType != null && agentType.toLowerCase().endsWith("reviewer")

const VERDICT_WORDS: ReadonlyArray<readonly [RegExp, ReviewVerdict]> = [
  [/^merge/, "merge"],
  [/^fix[ _-]?first/, "fix_first"],
  [/^ask(?: lucas| the person| you)?/, "ask"],
]

const markup = (line: string): string =>
  line.replace(/[*#`>]/g, "").replace(/^[\s_]+|[\s_]+$/g, "").replace(/\s+/g, " ").toLowerCase()

/**
 * The verdict a reviewer's reply leads with, or null (CEL-160): reviewers open with **merge**, **fix first**
 * or **ask Lucas** (`.claude/agents/cello-code-reviewer.md`). Reads the first three non-empty lines,
 * ignoring markdown and a "Verdict:" label (or a "Verdict" heading above the word). Without a label the word
 * must stand alone or be followed by punctuation, so prose ("Merge looks fine", "I'll merge…") isn't one.
 * Only the word is kept; the server never stores the reply.
 */
export const verdictOf = (text: string): ReviewVerdict | null => {
  const lines = text.split("\n").map(markup).filter((l) => l !== "").slice(0, 3)
  let labelled = false
  for (const line of lines) {
    let rest = line
    const label = /^verdict\b[:\s.,—–-]*/.exec(rest)
    if (label) {
      rest = rest.slice(label[0].length)
      labelled = true
      if (rest === "") continue
    }
    for (const [pattern, verdict] of VERDICT_WORDS) {
      const m = pattern.exec(rest)
      if (!m) continue
      const after = rest.slice(m[0].length)
      const wholeWord = !/^[a-z0-9]/.test(after)
      if (wholeWord && (labelled || after === "" || /^\s*[:.,;—–(-]/.test(after))) return verdict
    }
    return null
  }
  return null
}
