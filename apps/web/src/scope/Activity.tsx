// CEL-76 scope (removed in the real build): how a card shows an agent working on it right now, picked
// with `?activity=sweep|edge`. Both play once per check-in, on the same trigger as the agent mark's
// burst (CEL-69: the agent starts working or thinking, or checks in while at it), and nothing loops: a
// page load plays nothing, and an idle board runs nothing.
//
//   sweep: the status icon's ring gets one arc in the agent's colour that runs once round it.
//   edge:  while the agent is active the card has a thin edge in its colour (static); per check-in the
//          status icon's half fill turns once, like a pie chart ticking over.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Status, Task } from "@cello/contract/entities"
import { presenceOf } from "@cello/shared/presence"
import { useState } from "react"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { agentMood, agentPresenceSubject, provenanceOf } from "../presence/model.ts"
import { useNow } from "../presence/useNow.ts"
import type { ActivityStyle } from "./receipts.ts"
import { currentActivityStyle } from "./switch.ts"
import "./scope.css"

/** The switch, read once per render. */
export const useActivityStyle = (): ActivityStyle | null => currentActivityStyle()

/**
 * Whether an agent is at work on the task (active, and working or thinking), in which colour, and how
 * many check-ins arrived since the card was drawn (the key of the one-off motion).
 */
function useActivity(task: Task, board: BoardState) {
  const now = useNow()
  const p = provenanceOf(board, task, now)
  const holder = p.holder
  const subject = holder?.agent ? agentPresenceSubject(board, holder.agent) : (holder?.session ?? null)
  const presence = subject ? presenceOf(subject, now) : "ended"
  const mood = agentMood(task.stage, board.statuses[task.statusId], presence)
  const busy = mood === "working" || mood === "thinking"
  const key = `${mood}|${subject?.lastSeenAt ?? ""}`
  const [last, setLast] = useState(key)
  const [plays, setPlays] = useState(0)
  if (key !== last) {
    setLast(key)
    if (busy) setPlays(plays + 1)
  }
  return { busy, color: holder?.who.color ?? "var(--faint)", plays }
}

/** The card's status icon with the activity treatment; any other status draws as usual. */
export function ActiveStatusIcon({ task, board, status, style }: { task: Task; board: BoardState; status: Status; style: ActivityStyle }) {
  const { busy, color, plays } = useActivity(task, board)
  if (status.category !== "started") return <StatusIcon category={status.category} color={status.color} />
  const played = plays > 0 && busy
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden className="shrink-0 overflow-visible" data-activity={style} data-activity-plays={plays}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke={status.color} strokeWidth="1.5" />
      {style === "edge" ? (
        <g key={played ? plays : "rest"} className={played ? "activity-turn" : undefined}>
          <path d="M7 3.5 A3.5 3.5 0 0 1 7 10.5 Z" fill={status.color} />
        </g>
      ) : (
        <path d="M7 3.5 A3.5 3.5 0 0 1 7 10.5 Z" fill={status.color} />
      )}
      {style === "sweep" && played ? (
        <g key={plays} className="activity-sweep">
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray="7 28" />
        </g>
      ) : null}
    </svg>
  )
}

/** edge: a thin edge in the agent's colour down the card's left side while it's at work; a soft flash per check-in. */
export function ActiveEdge({ task, board }: { task: Task; board: BoardState }) {
  const { busy, color, plays } = useActivity(task, board)
  if (!busy) return null
  return (
    <span aria-hidden className="activity-edge" data-activity-edge style={{ background: color }}>
      {plays > 0 ? <span key={plays} className="activity-edge-flash" style={{ background: color }} /> : null}
    </span>
  )
}
