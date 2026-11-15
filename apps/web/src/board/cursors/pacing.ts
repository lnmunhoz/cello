// How fast agent cursors play, from the M0 spike (docs/internals/spike-board-ui.md), and what each
// kind of change looks like as timed phases. Pure: the queue times steps with these, the DOM player
// draws them.

/** Pacing in ms at full speed. One move is about 1.1 s: glide, lift, travel, land, then the gap. */
export const PACING = {
  /** The cursor flies to the card: 120 ms + 0.35 ms a pixel, at most this. */
  glide: 300,
  glideBase: 120,
  glidePerPx: 0.35,
  lift: 110,
  travel: 480,
  land: 150,
  /** Pause between two steps of one session. */
  gap: 60,
  /** Above this many steps waiting (counting the one playing), every step speeds up. */
  shrinkAt: 2,
  /** The fastest a step gets, as a share of its full duration. */
  minScale: 0.35,
  /** Above this many waiting, the session skips to the end and says how many changes it made. */
  skipAt: 8,
  /** A skipping session goes back to playing after this much quiet. */
  quietMs: 700,
  /** The cursor stays this long after a session's last step, then fades. */
  cursorLinger: 600,
  cursorFade: 220,
  /** "Claude Code made 23 changes" shows this long. */
  toastMs: 2600,
  /** The ring left on a card after a change fades over this long. It runs beside the queue, never in it. */
  trail: 900,
} as const

/**
 * Share of a step's full duration it gets, given how many steps its session has waiting (counting
 * the one playing): 1 up to 2 waiting, then 2 / waiting, never below 0.35.
 */
export const speedScale = (waiting: number): number =>
  waiting <= PACING.shrinkAt ? 1 : Math.max(PACING.minScale, PACING.shrinkAt / waiting)

/** What a session did to a card, as the board shows it. */
export type StepKind = "move" | "create" | "title" | "field" | "comment" | "claim"

export type PhaseName =
  | "glide" // the cursor flies to the card (or the column's +)
  | "lift" // the card rises under the cursor
  | "travel" // the card rides with the cursor to its new slot
  | "land" // it settles
  | "appear" // a new card grows in
  | "type" // the title types out
  | "pulse" // the changed card pulses
  | "bubble" // a speech bubble (a comment, a claim) pops from the card
  | "highlight" // reduced motion: the cursor and a ring show at the card, nothing flies

export interface Phase {
  readonly name: PhaseName
  /** At full speed. A glide's is its longest; a short hop takes less (`glideMs`). */
  readonly ms: number
}

/** `full` flies; `reduced` (prefers-reduced-motion, or while Lucas drags a card) only highlights. */
export type Motion = "full" | "reduced"

const REDUCED: ReadonlyArray<Phase> = [{ name: "highlight", ms: 600 }]

const FULL: Readonly<Record<StepKind, ReadonlyArray<Phase>>> = {
  move: [
    { name: "glide", ms: PACING.glide },
    { name: "lift", ms: PACING.lift },
    { name: "travel", ms: PACING.travel },
    { name: "land", ms: PACING.land },
  ],
  create: [
    { name: "glide", ms: PACING.glide },
    { name: "appear", ms: 220 },
    { name: "type", ms: 420 },
  ],
  title: [
    { name: "glide", ms: PACING.glide },
    { name: "type", ms: 420 },
  ],
  field: [
    { name: "glide", ms: PACING.glide },
    { name: "pulse", ms: 420 },
  ],
  comment: [
    { name: "glide", ms: PACING.glide },
    { name: "bubble", ms: 900 },
  ],
  claim: [
    { name: "glide", ms: PACING.glide },
    { name: "bubble", ms: 700 },
  ],
}

/** The phases a step plays, in order. Reduced motion never flies: a short highlight instead. */
export const phasesFor = (kind: StepKind, motion: Motion): ReadonlyArray<Phase> => (motion === "reduced" ? REDUCED : FULL[kind])

/** A step's length at full speed. */
export const durationOf = (phases: ReadonlyArray<Phase>): number => phases.reduce((sum, p) => sum + p.ms, 0)

/** How long the cursor takes to fly `px` pixels: shorter hops are quicker, up to the glide's longest. */
export const glideMs = (px: number, longest: number = PACING.glide): number => Math.min(longest, PACING.glideBase + px * PACING.glidePerPx)
