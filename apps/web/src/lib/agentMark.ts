// The teardrop agent from Cello's icon (art/icon/icon.svg, docs/specs/app-icon/README.md) on its own,
// without the orange tile: a circle with one sharp corner, the tip, and two pill eyes. The board's
// agent cursors and the e2e videos' pointer draw it from here, and a test checks it against the icon,
// so the icon and the cursors can't drift apart. Plain strings, so a page script with no imports (the
// e2e overlay) can use it too.

/** The icon's coordinates (its 1024 canvas): the tip, and the circle the body is round around. */
export const AGENT_TIP = { x: 205, y: 185 } as const
/** The circle the body is round around; the eyes sit across its centre line. */
export const AGENT_CENTER = { x: 575, y: 570 } as const
export const AGENT_RADIUS = 270
const CENTER = AGENT_CENTER
const RADIUS = AGENT_RADIUS

const f = (n: number) => +n.toFixed(1)

/** A circle (c, r) with one sharp corner at p: two tangents from p, then the far side of the circle. */
const teardrop = (p: { x: number; y: number }, c: { x: number; y: number }, r: number) => {
  const dx = c.x - p.x
  const dy = c.y - p.y
  const base = Math.atan2(dy, dx)
  const t = Math.acos(r / Math.hypot(dx, dy))
  const a = { x: c.x + r * Math.cos(base + Math.PI - t), y: c.y + r * Math.sin(base + Math.PI - t) }
  const b = { x: c.x + r * Math.cos(base + Math.PI + t), y: c.y + r * Math.sin(base + Math.PI + t) }
  return `M${p.x} ${p.y} L${f(a.x)} ${f(a.y)} A${r} ${r} 0 1 0 ${f(b.x)} ${f(b.y)} Z`
}

/** The body's path, exactly as in the icon. */
export const AGENT_BODY = teardrop(AGENT_TIP, CENTER, RADIUS)

/** The two eyes: pills of 80 × 124, side by side across the circle's centre line. */
export const AGENT_EYES = [CENTER.x - 65, CENTER.x + 65].map((cx) => ({ x: cx - 40, y: CENTER.y + 5 - 62, w: 80, h: 124 }))

/**
 * The body as a spinner (CEL-69, the Working state): the same circle with its tip pulled in along the
 * same axis, to 79% of the way out, so it turns like a spinner's head without sweeping far past the mark.
 */
export const AGENT_SPINNER_BODY = teardrop(
  { x: f(CENTER.x + (AGENT_TIP.x - CENTER.x) * 0.79), y: f(CENTER.y + (AGENT_TIP.y - CENTER.y) * 0.79) },
  CENTER,
  RADIUS,
)

/** Happy eyes (Done, Merged): an arch over each pill, as wide as it, drawn as a round-capped stroke. */
export const AGENT_HAPPY_EYES = AGENT_EYES.map((e) => {
  const base = CENTER.y + 34
  return `M${e.x - 2} ${base} Q${e.x + e.w / 2} ${base - 78} ${e.x + e.w + 2} ${base}`
}).join(" ")
/** The happy eyes' stroke width, in the icon's units: the icon's thinnest line (docs/specs/app-icon), so it holds at 16 px. */
export const AGENT_HAPPY_STROKE = 64

/**
 * The square the animated mark draws in, in the icon's coordinates: tight round the body (tip to the
 * far side of the circle), so a mark sized like a 16 px icon is the body at about that size and lines
 * up with the text beside it. Motion (a hop, a spinning tip, a ring) spills outside it.
 */
export const AGENT_FRAME = { x: 190, y: 178, size: 670 } as const

/** A point of the icon as a percentage of AGENT_FRAME: what CSS transform origins and translations use. */
export const agentFramePoint = (p: { readonly x: number; readonly y: number }) => ({
  x: +(((p.x - AGENT_FRAME.x) / AGENT_FRAME.size) * 100).toFixed(2),
  y: +(((p.y - AGENT_FRAME.y) / AGENT_FRAME.size) * 100).toFixed(2),
})

/** The mark's own box in the icon's coordinates: the body's bounds, plus room for an outline. */
const PAD = 56
const VIEW = {
  x: AGENT_TIP.x - PAD,
  y: AGENT_TIP.y - PAD,
  w: CENTER.x + RADIUS - AGENT_TIP.x + 2 * PAD,
  h: CENTER.y + RADIUS - AGENT_TIP.y + 2 * PAD,
}

/** The mark drawn `width` px wide: its height, and where its tip lands inside it (the hotspot). */
export const agentMarkBox = (width: number) => {
  const scale = width / VIEW.w
  return { width, height: VIEW.h * scale, tip: { x: (AGENT_TIP.x - VIEW.x) * scale, y: (AGENT_TIP.y - VIEW.y) * scale } }
}

/** The teardrop's axis, from the tip through the circle's centre, in degrees. */
const AXIS = +((Math.atan2(CENTER.y - AGENT_TIP.y, CENTER.x - AGENT_TIP.x) * 180) / Math.PI).toFixed(1)

/**
 * A click, as keyframes for the drawn mark (with its transform origin on the tip): the body presses
 * toward its tip and swells across, then springs back. Only rotates and scales, so the tip stays put.
 */
export const AGENT_SQUASH: ReadonlyArray<{ readonly transform: string; readonly offset?: number }> = [
  { transform: `rotate(${AXIS}deg) scale(1, 1) rotate(-${AXIS}deg)` },
  { transform: `rotate(${AXIS}deg) scale(0.8, 1.12) rotate(-${AXIS}deg)`, offset: 0.4 },
  { transform: `rotate(${AXIS}deg) scale(1, 1) rotate(-${AXIS}deg)` },
]

export interface AgentMarkOptions {
  /** Drawn width in px; the height follows. */
  readonly width: number
  /** The body's fill: any CSS colour, `var(--agent)` included. */
  readonly body: string
  readonly eyes: string
  /** A thin line around the body, outside it, so it reads on any background. */
  readonly outline?: string
  /** The outline's width in px as drawn. */
  readonly outlinePx?: number
}

/**
 * The mark as SVG markup. The eyes are a group of their own (`data-agent-eyes`) that scales about its
 * centre, so they can blink. The outline is drawn under the fill (`paint-order`), so only its outer
 * half shows and the body keeps its full size.
 */
export const agentMarkSvg = ({ width, body, eyes, outline, outlinePx = 1.5 }: AgentMarkOptions): string => {
  const { height } = agentMarkBox(width)
  const unitsPerPx = VIEW.w / width
  const stroke = outline ? ` stroke="${outline}" stroke-width="${f(2 * outlinePx * unitsPerPx)}" stroke-linejoin="round" paint-order="stroke"` : ""
  const pills = AGENT_EYES.map((e) => `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.w / 2}"/>`).join("")
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}" aria-hidden="true">` +
    `<path d="${AGENT_BODY}" fill="${body}"${stroke}/>` +
    `<g data-agent-eyes style="transform-box:fill-box;transform-origin:center" fill="${eyes}">${pills}</g>` +
    `</svg>`
  )
}
