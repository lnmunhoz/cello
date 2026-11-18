// A card while an agent works on its task right now (CEL-76): a thin edge in the agent's colour down the
// card's left side, static, for as long as the agent is at work (active, and working or thinking); and each
// time it checks in or starts working or thinking while the card is on screen, the edge flashes once and
// the In Progress icon's half fill turns once. A page load plays neither, neither loops (the agent mark's
// own working loop is CEL-69's), and reduced motion keeps only the edge (index.css).
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Task } from "@cello/contract/entities"
import { presenceOf } from "@cello/domain/presence"
import { useState } from "react"
import { agentColor, agentMood, agentOn, agentPresenceSubject, sessionColor } from "./model.ts"
import { useNow } from "./useNow.ts"

export interface CardActivity {
  /** An agent is at work on the task: active, and working or thinking. */
  readonly busy: boolean
  /** Whoever the card's work line names (a subagent, else the session), in its colour. */
  readonly color: string
  /** Check-ins seen since the card was drawn, while busy: the key of the one-off motion (0: none yet). */
  readonly plays: number
}

/**
 * Whether an agent is at work on the task right now, in whose colour, and what a change to compare
 * against reads (`seen`: its mood and last check-in). Whoever the work line names (provenanceOf's
 * holder: a subagent working on it, else the claim's session), read directly, since every card runs
 * this on every board event. The board uses `busy` to position only the cards with an edge.
 */
export const activityOf = (board: BoardState, task: Task, now: number) => {
  const agent = agentOn(board, task, now)
  const session = task.assigneeSessionId === null ? undefined : board.sessions[task.assigneeSessionId]
  const subject = agent ? agentPresenceSubject(board, agent) : (session ?? null)
  const color = agent ? agentColor(agent) : session ? sessionColor(session) : "var(--faint)"
  const mood = agentMood(task.stage, board.statuses[task.statusId], subject ? presenceOf(subject, now) : "ended")
  return { busy: mood === "working" || mood === "thinking", color, seen: `${mood}|${subject?.lastSeenAt ?? ""}` }
}

/** What the card shows of the agent at work on its task. */
export function useCardActivity(task: Task, board: BoardState): CardActivity {
  const { busy, color, seen } = activityOf(board, task, useNow())
  // What it was first drawn with is the baseline: only a later check-in or mood plays.
  const [last, setLast] = useState(seen)
  const [plays, setPlays] = useState(0)
  if (seen !== last) {
    setLast(seen)
    if (busy) setPlays(plays + 1)
  }
  return { busy, color, plays: busy ? plays : 0 }
}

/** The card's edge while an agent is at work on it; a soft flash per check-in. */
export function ActivityEdge({ activity }: { activity: CardActivity }) {
  if (!activity.busy) return null
  return (
    <span aria-hidden className="activity-edge" data-activity-edge style={{ background: activity.color }}>
      {activity.plays > 0 ? <span key={activity.plays} className="activity-edge-flash" style={{ background: activity.color }} /> : null}
    </span>
  )
}
