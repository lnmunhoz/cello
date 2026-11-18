// What an agent cursor looks like: the teardrop agent from Cello's icon (apps/web/src/lib/agentMark), in
// the session's colour, its tip on the cursor's point. Pure markup and keyframes; the animator draws
// and plays them.
import { AGENT_SQUASH, agentMarkBox, agentMarkSvg } from "../../lib/agentMark.ts"

/** The mark's width in px. */
export const CURSOR_WIDTH = 26

/** Where the pill starts, right of the tip (index.css, `.agent-cursor span`). */
export const LABEL_OFFSET = 22

const { tip } = agentMarkBox(CURSOR_WIDTH)

/**
 * The mark, placed so its tip sits on the cursor element's origin: the animator moves the element to
 * a point and the tip points at it, through the flight, lift, carry and land. It squashes about the tip.
 */
export const cursorMark = (): string =>
  agentMarkSvg({ width: CURSOR_WIDTH, body: "var(--agent)", eyes: "white", outline: "white" }).replace(
    "<svg ",
    `<svg data-agent-mark style="left:-${tip.x}px;top:-${tip.y}px;transform-origin:${tip.x}px ${tip.y}px" `,
  )

/** A click (landing a card, pressing a column's +): the mark squashes about its tip. */
export const SQUASH: Keyframe[] = AGENT_SQUASH.map((k) => ({ ...k }))
export const SQUASH_MS = 260

/** One blink while the cursor lingers after a session's last step. */
export const BLINK: Keyframe[] =[{ transform: "scaleY(1)" }, { transform: "scaleY(0.12)", offset: 0.5 }, { transform: "scaleY(1)" }]
export const BLINK_MS = 170
/** How long after a step ends the blink starts; a next step starting sooner cancels it. */
export const BLINK_DELAY = 240
