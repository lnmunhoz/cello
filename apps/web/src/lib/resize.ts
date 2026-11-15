// The width of a panel you resize by dragging one of its edges (the sidebar's right edge, the
// viewer's left edge): its limits, the drag, the arrow keys, and the width remembered on this device.
// Pure, so the rules are tested once here; components/ui/ResizeHandle.tsx maps them to the DOM.

export interface WidthRule {
  /** Before anything is remembered. */
  readonly initial: number
  readonly min: number
  /** Its own maximum, if any. */
  readonly max?: number
  /** Room it leaves for what's beside it in the same container (the minimum still wins). */
  readonly minRest: number
  /** One press of ← or →. */
  readonly step: number
}

/** Which edge of the panel is dragged: the viewer's left one, the sidebar's right one. */
export type Edge = "left" | "right"

const within = (width: number, rule: WidthRule) => Math.round(Math.max(rule.min, Math.min(width, rule.max ?? Infinity)))

/** The width saved in localStorage, within the panel's own limits, or the initial one. */
export const readWidth = (stored: string | null, rule: WidthRule): number => {
  const width = Number(stored)
  return stored !== null && Number.isFinite(width) && width > 0 ? within(width, rule) : rule.initial
}

/** Between the minimum and the smaller of the maximum and what leaves `minRest` of the container. */
export const clampWidth = (width: number, rule: WidthRule, container: number): number =>
  Math.round(Math.max(rule.min, Math.min(width, rule.max ?? Infinity, container - rule.minRest)))

/** The width while `edge` is dragged from `start.x` to `x`. */
export const dragWidth = (start: { readonly width: number; readonly x: number }, x: number, edge: Edge, rule: WidthRule, container: number): number =>
  clampWidth(start.width + (edge === "right" ? x - start.x : start.x - x), rule, container)

/** ← and → move the edge one step that way; null for any other key. */
export const keyWidth = (key: string, width: number, edge: Edge, rule: WidthRule, container: number): number | null => {
  const direction = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0
  if (direction === 0) return null
  return clampWidth(width + (edge === "right" ? direction : -direction) * rule.step, rule, container)
}

/** `clampWidth`'s limits as CSS against the container, so a window made narrower keeps them too. */
export const widthLimits = (rule: WidthRule): { readonly minWidth: string; readonly maxWidth: string } => {
  const min = `min(${rule.min}px, 100%)`
  const rest = `calc(100% - ${rule.minRest}px)`
  return { minWidth: min, maxWidth: `max(${min}, ${rule.max === undefined ? rest : `min(${rule.max}px, ${rest})`})` }
}
