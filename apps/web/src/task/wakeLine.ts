// The task panel's wake line (CEL-92), under Working on it: what Cello is doing about the claim
// holder's session when Lucas acts on the task while nothing of it runs. Before (a wake is due, with
// Don't wake), during (a woken run, with Stop and Log), after (how it ended, with Log), or not woken and
// why. It reads the board's latest wake of the task (`wakes`), and goes once the session comes back by
// itself, or another session holds the claim.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Task } from "@cello/contract/entities"
import { NOT_WOKEN_TEXT, RUN_END_TEXT, runLength } from "@cello/contract/wake"
import { agoShort } from "@cello/shared/presence"

export type WakeLine =
  | { readonly kind: "scheduled"; readonly text: string; readonly at: number }
  | { readonly kind: "running"; readonly text: string; readonly runId: string }
  | { readonly kind: "ended"; readonly text: string; readonly runId: string }
  | { readonly kind: "not_woken"; readonly text: string }

/** A session that checks in this long after a wake event came back by itself: the line is old news. */
const CAME_BACK_MS = 5_000

/** A due wake this far past its time and still not run or called off is stale (another task's run took it). */
const STALE_MS = 60_000

export const wakeLine = (task: Pick<Task, "id" | "assigneeSessionId">, board: Pick<BoardState, "sessions" | "wakes">, now: number): WakeLine | null => {
  const wake = board.wakes[task.id]
  if (!wake || wake.sessionId !== task.assigneeSessionId) return null
  const session = board.sessions[wake.sessionId]
  const short = (session?.externalId ?? wake.sessionId).slice(0, 8)
  const cameBack = (since: number) => session !== undefined && session.lastSeenAt > since + CAME_BACK_MS
  switch (wake.state) {
    case "scheduled": {
      if (wake.at === null || now - wake.at > STALE_MS) return null
      return { kind: "scheduled", text: `Session ${short} isn't running. Cello will wake it in ${Math.round((wake.at - wake.ts) / 1000)} s`, at: wake.at }
    }
    case "running":
      return wake.run ? { kind: "running", text: "Woken by Cello · running", runId: wake.run.id } : null
    case "ended": {
      const run = wake.run
      if (!run || run.endedAt === null || cameBack(run.endedAt)) return null
      const how = `${RUN_END_TEXT[run.outcome]} ${runLength(run.endedAt - run.startedAt)}${run.error ? `: ${run.error}` : ""}`
      return { kind: "ended", text: `Woken by Cello ${agoShort(run.endedAt, now)} · ${how}`, runId: run.id }
    }
    case "not_woken":
      if (wake.reason === null || wake.reason === "taken" || cameBack(wake.ts)) return null
      return { kind: "not_woken", text: `Not woken: ${NOT_WOKEN_TEXT[wake.reason]}` }
  }
}
