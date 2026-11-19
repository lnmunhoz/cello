/**
 * The app's one set of motion tokens (CEL-189). Every transition reads its timing from here, or from the
 * CSS variables of the same values in index.css (`--motion-fast`, `--motion-ease-out`, ...), which
 * motion.test.ts keeps in step.
 *
 * Motion answers something: an event arriving, an agent at work on a card, or the human's own action (a
 * menu opening, a drop, a submit). An idle page runs no animations (docs/internals/spike-board-ui.md).
 * Reduced motion sets the CSS durations to 0; `MotionConfig reducedMotion="user"` does the same for
 * `motion` springs.
 */

/** Durations in milliseconds: `fast` for small popups and hovers, `base` for dialogs, `slow` for panels. */
export const duration = { fast: 120, base: 180, slow: 240 } as const

/** Cubic-bezier curves: `out` for things entering or answering a click, `inOut` for things moving across. */
export const easing = {
  out: [0.16, 1, 0.3, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>

/** An easing as CSS writes it, e.g. `cubic-bezier(0.16, 1, 0.3, 1)`. */
export const cssEasing = (name: keyof typeof easing) => `cubic-bezier(${easing[name].join(", ")})`

/** The one spring: cards settling on the board after a drop or an event. */
export const spring = { type: "spring", stiffness: 520, damping: 42, mass: 0.7 } as const

/** The transition `motion`'s `layout` animations use: the spring. */
export const layoutTransition = spring

/** No motion: what the human's own view changes (a project pick) run on, so rows snap instead of gliding (CEL-188). */
export const instant = { duration: 0 } as const

/**
 * How a panel leaves when the human closes it: it slides out when it is on screen and motion is allowed,
 * and leaves at once otherwise. A hidden panel's slide is cancelled and never ends, so waiting on it
 * would leave the panel stuck closing.
 */
export const exitMotion = ({ reduceMotion, shown }: { reduceMotion: boolean; shown: boolean }): "slide" | "leave" =>
  reduceMotion || !shown ? "leave" : "slide"
