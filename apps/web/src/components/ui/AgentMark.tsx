// The teardrop agent from Cello's icon (@cello/shared/agentMark), alive (CEL-69): one mark with a mood
// that says what its agent is doing. Two colours, both CSS variables, so the same mark draws in a
// session's colour, the brand orange with ink eyes, or ink on light. The motion is ./AgentMark.css.
import {
  AGENT_BODY,
  AGENT_CENTER,
  AGENT_EYES,
  AGENT_FRAME,
  AGENT_HAPPY_EYES,
  AGENT_HAPPY_STROKE,
  AGENT_RADIUS,
  AGENT_SPINNER_BODY,
} from "@cello/shared/agentMark"
import type { AnimationEvent, CSSProperties } from "react"
import "./AgentMark.css"

/**
 * still: no motion. working: the tip spins (loops). thinking: leans back and sways, eyes up (loops).
 * waiting: big eyes looking up; plays a double hop and a ring. done: at rest; plays a jump for joy.
 * merged: happy eyes, still. Give the looping moods only while the agent is active.
 */
export type AgentMood = "still" | "working" | "thinking" | "waiting" | "done" | "merged"

const VIEW_BOX = `${AGENT_FRAME.x} ${AGENT_FRAME.y} ${AGENT_FRAME.size} ${AGENT_FRAME.size}`

/** The last animation of each entry (AgentMark.css): when it ends, the entry has played. */
const PLAY_END: Partial<Record<AgentMood, string>> = { done: "agent-done-rig", waiting: "agent-ring" }

export interface AgentMarkProps {
  readonly mood?: AgentMood
  /** Play the mood's entry once (Done's jump, Needs input's hop). Only for a change seen on screen, never on page load. */
  readonly play?: boolean
  /** Width and height in px. The body fills the box; motion spills outside it. */
  readonly size?: number
  /** The body's colour, any CSS colour. Unset, it inherits `--agent-body`, else the text colour. */
  readonly body?: string
  /** The eyes' colour. Unset, it inherits `--agent-eye`, else the surface colour. */
  readonly eye?: string
  /** Called once the entry has played. */
  readonly onPlayed?: () => void
  readonly [data: `data-${string}`]: string | undefined
}

export function AgentMark({ mood = "still", play = false, size = 16, body, eye, onPlayed, ...data }: AgentMarkProps) {
  const style = { width: size, height: size, "--agent-body": body, "--agent-eye": eye } as CSSProperties
  const ended = (e: AnimationEvent) => {
    if (e.animationName === PLAY_END[mood]) onPlayed?.()
  }
  return (
    <span {...data} className="agent-mark" data-agent-mood={mood} data-play={play ? "" : undefined} style={style} aria-hidden onAnimationEnd={ended}>
      {mood === "waiting" ? (
        <span className="am-ring">
          <svg viewBox={VIEW_BOX}>
            <circle cx={AGENT_CENTER.x} cy={AGENT_CENTER.y} r={AGENT_RADIUS} strokeWidth={40} />
          </svg>
        </span>
      ) : null}
      <span className="am-rig">
        <span className="am-squash">
          <span className="am-tilt">
            <span className="am-body">
              <svg viewBox={VIEW_BOX}>
                <path d={mood === "working" ? AGENT_SPINNER_BODY : AGENT_BODY} />
              </svg>
            </span>
            <span className="am-face">
              <span className="am-eyes">
                <svg viewBox={VIEW_BOX}>
                  {AGENT_EYES.map((e) => (
                    <g key={e.x} className="am-pose">
                      <rect x={e.x} y={e.y} width={e.w} height={e.h} rx={e.w / 2} />
                    </g>
                  ))}
                </svg>
              </span>
              {mood === "done" || mood === "merged" ? (
                <span className="am-happy">
                  <svg viewBox={VIEW_BOX}>
                    <path d={AGENT_HAPPY_EYES} strokeWidth={AGENT_HAPPY_STROKE} />
                  </svg>
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </span>
    </span>
  )
}
