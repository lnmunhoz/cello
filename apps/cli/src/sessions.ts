// What `cello sessions wake` and `cello sessions runs` print (CEL-92): a woken run and where its log is.
import type { SessionRun } from "@cello/contract/entities"
import { runLength, WAKE_WHY_TEXT } from "@cello/contract/wake"
import { shortSession } from "@cello/domain/session"
import { columns, localTime } from "./format.ts"

/** Whether an argument is a task key (CEL-92) rather than a session id. */
export const isTaskKey = (text: string): boolean => /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(text.trim())

/** After `cello sessions wake`: which session woke, its mode, its log, how to stop it. */
export const wokeText = (session: string, run: SessionRun, log: string | null): string =>
  [
    `Woke session ${shortSession(session)} (mode ${run.mode}). It runs \`cello inbox\`, acts, answers on the card, then exits.`,
    ...(log ? [`Log: ${log}`] : []),
    `Stop it with Stop on the card, or see its runs with \`cello sessions runs ${shortSession(session)}\`.`,
  ].join("\n")

/** "running", "completed in 1 min", "failed after 2 min: …", "stopped after 40 s". */
const endText = (run: SessionRun): string => {
  if (run.endedAt === null) return "running"
  const length = runLength(run.endedAt - run.startedAt)
  if (run.outcome === "completed") return `completed in ${length}`
  return `${run.outcome} after ${length}${run.error ? `: ${run.error}` : ""}`
}

/** `cello sessions runs`: each run newest first, its log under it. */
export const runsText = (session: string, runs: ReadonlyArray<{ readonly run: SessionRun; readonly log: string }>): string => {
  if (runs.length === 0) return `Cello hasn't woken session ${shortSession(session)}.`
  const lines = columns(runs.map(({ run }) => [localTime(run.startedAt), WAKE_WHY_TEXT[run.why], run.mode, endText(run)]))
  return [`Woken runs of session ${shortSession(session)}, newest first:`, ...lines.flatMap((line, i) => [`  ${line}`, `    ${runs[i]!.log}`])].join("\n")
}
