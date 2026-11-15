// Zoom and pan for an image on a stage (the image modal): fit, clamping, zooming around a point, the
// wheel and a pinch. Pure, so the maths is tested once here; the component maps a View to a CSS transform.

export interface Size {
  readonly width: number
  readonly height: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

/** The image's natural size, and the stage it's shown on, in CSS px. */
export interface Frame {
  readonly image: Size
  readonly stage: Size
}

/** How the image is shown: drawn at `scale` × its natural size, its top-left corner at (x, y) on the stage. */
export interface View {
  readonly scale: number
  readonly x: number
  readonly y: number
}

/** Room left around a fitted image, in px. */
export const FIT_MARGIN = 16

/** 800%: enough to read a single line of a screenshot. */
export const MAX_SCALE = 8

/** The scale that shows the whole image with the margin around it, never past 100%. */
export const fitScale = ({ image, stage }: Frame): number => {
  if (image.width <= 0 || image.height <= 0) return 1
  const width = Math.max(stage.width - 2 * FIT_MARGIN, 1)
  const height = Math.max(stage.height - 2 * FIT_MARGIN, 1)
  return Math.min(1, width / image.width, height / image.height)
}

/** One side: centred when the image is smaller than the stage, else kept from showing past its edges. */
const clampSide = (offset: number, drawn: number, stage: number): number =>
  drawn <= stage ? (stage - drawn) / 2 : Math.min(0, Math.max(stage - drawn, offset))

/** Between fit and the maximum, and never dragged past the image's edges. */
export const clampView = (view: View, frame: Frame): View => {
  const scale = Math.min(MAX_SCALE, Math.max(fitScale(frame), view.scale))
  return {
    scale,
    x: clampSide(view.x, frame.image.width * scale, frame.stage.width),
    y: clampSide(view.y, frame.image.height * scale, frame.stage.height),
  }
}

/** The whole image, centred. */
export const fitView = (frame: Frame): View => clampView({ scale: fitScale(frame), x: 0, y: 0 }, frame)

/** Bigger than fit: it can be dragged. */
export const isZoomed = (view: View, frame: Frame): boolean => view.scale > fitScale(frame) + 1e-6

/** To `scale`, keeping the image point under `point` where it is (then clamped). */
export const zoomAt = (view: View, scale: number, point: Point, frame: Frame): View => {
  const next = Math.min(MAX_SCALE, Math.max(fitScale(frame), scale))
  const ratio = next / view.scale
  return clampView({ scale: next, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio }, frame)
}

export const zoomBy = (view: View, factor: number, point: Point, frame: Frame): View => zoomAt(view, view.scale * factor, point, frame)

/** Double-click: from fit to 100% around the point clicked; from any zoom back to fit. */
export const toggleZoom = (view: View, point: Point, frame: Frame): View =>
  isZoomed(view, frame) ? fitView(frame) : zoomAt(view, 1, point, frame)

export const panBy = (view: View, delta: Point, frame: Frame): View => clampView({ ...view, x: view.x + delta.x, y: view.y + delta.y }, frame)

const middle = ([a, b]: readonly [Point, Point]): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = ([a, b]: readonly [Point, Point]): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Two fingers moving from `from` to `to`: scaled by how far they spread, around where they were, then moved with them. */
export const pinch = (view: View, from: readonly [Point, Point], to: readonly [Point, Point], frame: Frame): View => {
  const before = distance(from)
  const factor = before > 0 ? distance(to) / before : 1
  const a = middle(from)
  const b = middle(to)
  return panBy(zoomBy(view, factor, a, frame), { x: b.x - a.x, y: b.y - a.y }, frame)
}

const LINE_PX = 16
/** One event moves at most this far, so a page-sized delta or a fast flick is a step, not a jump. */
const MAX_WHEEL_PX = 300

/**
 * How much one wheel event zooms by: up zooms in. A trackpad pinch arrives as a wheel with Ctrl held
 * and small deltas, so it's counted faster than a mouse wheel's 100 px notches.
 */
export const wheelFactor = (e: { readonly deltaY: number; readonly deltaMode: number; readonly ctrlKey: boolean }): number => {
  const px = e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaMode === 2 ? Math.sign(e.deltaY) * MAX_WHEEL_PX : e.deltaY
  const capped = Math.max(-MAX_WHEEL_PX, Math.min(MAX_WHEEL_PX, px))
  return capped === 0 ? 1 : Math.exp(-capped * (e.ctrlKey ? 0.01 : 0.002))
}

/** The stage changed size: a fitted image is fitted again; a zoomed one keeps its scale and the point at the centre. */
export const refit = (view: View, from: Frame, to: Frame): View =>
  isZoomed(view, from)
    ? clampView(
        { scale: view.scale, x: view.x + (to.stage.width - from.stage.width) / 2, y: view.y + (to.stage.height - from.stage.height) / 2 },
        to,
      )
    : fitView(to)
