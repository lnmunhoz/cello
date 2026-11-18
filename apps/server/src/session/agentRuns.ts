// A subagent's runs on a task (CEL-160), rebuilt from its agent.seen events. The `session_agents` row holds
// only the latest state: a reviewer that finished, was resumed and finished again shows one `endedAt` and one
// verdict. Every start, stop and resume writes an agent.seen (EventStore, entity `<session>/<agent>`), and a
// stop's carries the endedAt and verdict it set, so the runs can be told apart again. Pure.
import type { ReviewVerdictSeen, SessionAgent } from "@cello/contract/entities"

/** What of an agent a run is read from: the row, or an agent.seen's copy of it. */
export type SeenAgent = Pick<SessionAgent, "startedAt" | "lastSeenAt" | "endedAt"> & { readonly verdict?: ReviewVerdictSeen | null | undefined }

/** One run: it started, and either ended (with a verdict, when a reviewer left one) or is still going. */
export interface Run {
  readonly startedAt: number
  readonly endedAt: number | null
  readonly verdict: ReviewVerdictSeen | null
}

/**
 * The runs of `agent`, oldest first, from its agent.seen events (`seen`, in any order) and its row:
 * - the first run starts when the agent did;
 * - an event with an `endedAt` ends the open run (a repeat of the same stop changes nothing; a later one
 *   with no resume between moves the end and the verdict);
 * - an event without one, seen after a run ended and not stale (its lastSeenAt is past the end), is a
 *   resume: the next run starts at that event;
 * - then the row settles what the events missed: its endedAt closes an open run, and a row that is working
 *   again after the last run ended opens one at its lastSeenAt.
 */
export const agentRuns = (agent: SeenAgent, seen: ReadonlyArray<{ readonly ts: number; readonly agent: SeenAgent }>): ReadonlyArray<Run> => {
  const runs: Array<{ startedAt: number; endedAt: number | null; verdict: ReviewVerdictSeen | null }> = [
    { startedAt: agent.startedAt, endedAt: null, verdict: null },
  ]
  const last = () => runs[runs.length - 1]!
  const finish = (endedAt: number, verdict: ReviewVerdictSeen | null) => {
    const run = last()
    if (run.endedAt === null || endedAt > run.endedAt) {
      run.endedAt = endedAt
      run.verdict = verdict
    }
  }
  for (const event of [...seen].sort((a, b) => a.ts - b.ts)) {
    const a = event.agent
    if (a.endedAt !== null) finish(a.endedAt, a.verdict ?? null)
    else if (last().endedAt !== null && a.lastSeenAt > last().endedAt!) runs.push({ startedAt: event.ts, endedAt: null, verdict: null })
  }
  if (agent.endedAt !== null) finish(agent.endedAt, agent.verdict ?? null)
  else if (last().endedAt !== null) runs.push({ startedAt: agent.lastSeenAt, endedAt: null, verdict: null })
  return runs
}
