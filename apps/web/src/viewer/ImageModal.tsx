import { ChevronLeftIcon, ChevronRightIcon, ImageOffIcon, MinusIcon, PanelRightOpenIcon, PlusIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/Dialog.tsx"
import { diagramSize } from "../docs/diagram.ts"
import { useDiagram } from "../docs/Mermaid.tsx"
import { openInPanel } from "../lib/desktop.ts"
import { fitView, isZoomed, panBy, pinch, refit, toggleZoom, wheelAction, zoomBy, type Frame, type Point, type Size, type View } from "../lib/zoom.ts"
import { closedImageModal, closeImageModal, imageModal, stepImage, useImageModal, type ImageModalState, type ModalDiagram, type ModalItem } from "./imageModal.ts"

/**
 * The image modal: a screenshot or a diagram over the whole window on a dark backdrop, fitted, to zoom
 * (wheel, pinch, double-click, +/−) and drag around, with ←/→ through the other images and diagrams it
 * was opened with. Esc, the close button or a click on the backdrop closes it, and the focus goes back
 * to the thumbnail or diagram. Opened with `openImageModal` (imageModal.ts); the app shell mounts one.
 */
export function ImageModal() {
  const state = useImageModal()
  // Kept while it closes, so the content fades out with the image still in it.
  const [last, setLast] = useState(state)
  if (state && state !== last) setLast(state)
  const shown = state ?? last
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        // Esc (the dialog asks): close, unless the store already did, with something to do after.
        if (!open && imageModal() !== null) closeImageModal()
      }}
      onOpenChangeComplete={(open) => {
        if (!open) closedImageModal()
      }}
    >
      {shown ? <Content state={shown} /> : null}
    </Dialog>
  )
}

function Content({ state }: { state: ImageModalState }) {
  const item = state.items[state.index]!
  const count = state.items.length
  // Another item starts fitted again; two copies of one diagram in a row are still two items.
  const key = `${state.index} ${item.kind === "diagram" ? item.source : item.url}`
  const zoom = useZoom(key)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const action = KEYS[e.key]
    if (!action) return
    e.preventDefault()
    if (action === "previous") stepImage(-1)
    else if (action === "next") stepImage(1)
    else if (!zoom.broken) zoom.button(action)
  }
  return (
    <DialogContent size="screen" initialFocus="content" finalFocus={state.opener ?? "trigger"} onKeyDown={onKeyDown} data-image-modal="">
      <header className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <DialogTitle size="sm">{item.title}</DialogTitle>
          {item.kind !== "diagram" && item.name && item.name !== item.title ? <span className="min-w-0 truncate text-xs text-white/55">{item.name}</span> : null}
        </div>
        {count > 1 ? (
          <DialogDescription>
            <span aria-live="polite" data-image-count="" className="text-xs tabular-nums text-white/70">
              {state.index + 1} of {count}
            </span>
          </DialogDescription>
        ) : null}
        <div role="toolbar" aria-label="Zoom" className="ml-2 flex items-center gap-0.5">
          <Button variant="overlay" size="iconMd" aria-label="Zoom out" title="Zoom out (−)" disabled={zoom.broken || !zoom.zoomed} onClick={() => zoom.button("out")}>
            <MinusIcon aria-hidden className="size-4" />
          </Button>
          <Button
            variant="overlay"
            size="md"
            aria-label={zoom.zoomed ? "Fit to screen" : "Zoom to 100%"}
            title={zoom.zoomed ? "Fit to screen (0)" : "Zoom to 100% (double-click)"}
            aria-pressed={zoom.zoomed}
            disabled={zoom.broken}
            onClick={() => zoom.button("toggle")}
          >
            <span data-zoom-percent="" className="w-10 tabular-nums">
              {zoom.percent}%
            </span>
          </Button>
          <Button variant="overlay" size="iconMd" aria-label="Zoom in" title="Zoom in (+)" disabled={zoom.broken} onClick={() => zoom.button("in")}>
            <PlusIcon aria-hidden className="size-4" />
          </Button>
        </div>
        {item.kind !== "diagram" ? (
          <Button
            variant="overlay"
            size="md"
            aria-label={`Open ${item.title} in the viewer`}
            // After the modal has closed and given the focus back, so the viewer returns it there in turn.
            onClick={() => closeImageModal(() => openInPanel(item.url, item.title, "image"))}
          >
            <PanelRightOpenIcon aria-hidden className="size-3.5" />
            Open in viewer
          </Button>
        ) : null}
        <Button variant="overlay" size="iconMd" aria-label="Close" title="Close (Esc)" onClick={() => closeImageModal()}>
          <XIcon aria-hidden className="size-4" />
        </Button>
      </header>
      <Stage item={item} itemKey={key} zoom={zoom} />
      {count > 1 ? (
        <>
          <Step side="previous" disabled={state.index === 0} />
          <Step side="next" disabled={state.index === count - 1} />
        </>
      ) : null}
    </DialogContent>
  )
}

const KEYS: Record<string, "previous" | "next" | "in" | "out" | "fit"> = {
  ArrowLeft: "previous",
  ArrowRight: "next",
  "+": "in",
  "=": "in",
  "-": "out",
  "0": "fit",
}

function Step({ side, disabled }: { side: "previous" | "next"; disabled: boolean }) {
  const Icon = side === "previous" ? ChevronLeftIcon : ChevronRightIcon
  return (
    <div className={`absolute top-1/2 -translate-y-1/2 ${side === "previous" ? "left-3" : "right-3"}`}>
      <Button
        variant="floating"
        size="iconLg"
        aria-label={side === "previous" ? "Previous image" : "Next image"}
        title={side === "previous" ? "Previous (←)" : "Next (→)"}
        disabled={disabled}
        onClick={() => stepImage(side === "previous" ? -1 : 1)}
      >
        <Icon aria-hidden className="size-5" />
      </Button>
    </div>
  )
}

interface ZoomState {
  /** Which item it's for. */
  readonly key: string
  readonly stage: Size | null
  /** The image's natural size, or the diagram's drawn size. */
  readonly image: Size | null
  /** Null: fitted, and fitted again whenever the stage changes size. */
  readonly view: View | null
  /** A button, a key or a double-click: the change animates. A wheel, a drag or a pinch follows the hand. */
  readonly smooth: boolean
  /** The image didn't load, or the diagram didn't draw: there's nothing to zoom. */
  readonly broken: boolean
}

const blank = (key: string): ZoomState => ({ key, stage: null, image: null, view: null, smooth: false, broken: false })
const frameOf = (s: ZoomState): Frame | null => (s.stage && s.image ? { stage: s.stage, image: s.image } : null)

/** A change to the view, kept only when it's zoomed in (fitted stays null). */
const withView = (s: ZoomState, change: (view: View, frame: Frame) => View, smooth: boolean): ZoomState => {
  const frame = frameOf(s)
  if (!frame) return s
  const next = change(s.view ?? fitView(frame), frame)
  return { ...s, view: isZoomed(next, frame) ? next : null, smooth }
}

const STEP = 1.5

type Zoom = ReturnType<typeof useZoom>

/** The zoom state of the item shown, reset (keeping the stage's size) when another item is shown. */
function useZoom(key: string) {
  const [state, setState] = useState(() => blank(key))
  const current = state.key === key ? state : { ...blank(key), stage: state.stage }
  if (current !== state) setState(current)
  const frame = frameOf(current)
  const view = frame ? (current.view ?? fitView(frame)) : null
  const centre = (s: ZoomState): Point => ({ x: (s.stage?.width ?? 0) / 2, y: (s.stage?.height ?? 0) / 2 })
  return {
    state: current,
    view,
    zoomed: current.view !== null,
    broken: current.broken,
    percent: view ? Math.round(view.scale * 100) : 100,
    /** Stable: the stage's listeners keep the first one. */
    update: setState,
    button: (action: "in" | "out" | "fit" | "toggle") =>
      setState((s) =>
        withView(
          s,
          (v, f) =>
            action === "in"
              ? zoomBy(v, STEP, centre(s), f)
              : action === "out"
                ? zoomBy(v, 1 / STEP, centre(s), f)
                : action === "fit"
                  ? fitView(f)
                  : toggleZoom(v, centre(s), f),
          true,
        ),
      ),
  }
}

/** Where a pointer went down, and whether it has moved far enough to be a drag rather than a click. */
interface Press {
  readonly onBackdrop: boolean
  dragged: boolean
}

const DRAG_PX = 4

function Stage({ item, itemKey, zoom }: { item: ModalItem; itemKey: string; zoom: Zoom }) {
  const ref = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const press = useRef<Press | null>(null)
  const { view, update } = zoom
  // The image or the diagram, drawn at its natural size and moved and scaled into place.
  const placed = view
    ? { width: zoom.state.image!.width, height: zoom.state.image!.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }
    : undefined
  const placement = `absolute top-0 left-0 max-w-none origin-top-left ${view && !zoom.broken ? "" : "invisible"} ${zoom.zoomed ? "" : "cursor-zoom-in"} ${zoom.state.smooth ? "transition-transform duration-150 ease-out motion-reduce:transition-none" : ""}`
  const at = (e: { clientX: number; clientY: number }): Point => {
    const box = ref.current!.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }

  // The stage's size, now and whenever the window changes.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const stage = { width: entry!.contentRect.width, height: entry!.contentRect.height }
      update((s) => {
        const from = frameOf(s)
        const to = s.image ? { stage, image: s.image } : null
        return { ...s, stage, view: s.view && from && to ? refit(s.view, from, to) : null, smooth: false }
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [update])

  // A pinch or a mouse wheel zooms around the pointer; a two-finger trackpad scroll pans (wheelAction).
  // Not passive, and over the whole modal (the toolbar too), so the page never zooms or scrolls instead.
  useEffect(() => {
    const el = ref.current
    const modal = el?.closest<HTMLElement>("[data-image-modal]")
    if (!el || !modal) return
    const keepFromPage = (e: WheelEvent) => e.preventDefault()
    const onWheel = (e: WheelEvent) => {
      const box = el.getBoundingClientRect()
      const point = { x: e.clientX - box.left, y: e.clientY - box.top }
      update((s) => {
        const action = wheelAction(e, s.view !== null)
        if (action.kind === "zoom") return withView(s, (v, f) => zoomBy(v, action.factor, point, f), false)
        if (action.kind === "pan") return withView(s, (v, f) => panBy(v, action.delta, f), false)
        return s
      })
    }
    modal.addEventListener("wheel", keepFromPage, { passive: false })
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      modal.removeEventListener("wheel", keepFromPage)
      el.removeEventListener("wheel", onWheel)
    }
  }, [update])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    pointers.current.set(e.pointerId, at(e))
    if (pointers.current.size === 1) press.current = { onBackdrop: e.target === e.currentTarget, dragged: false }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(e.pointerId)
    if (!before) return
    const point = at(e)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()]
      const from = [a![1], b![1]] as const
      pointers.current.set(e.pointerId, point)
      const to = [pointers.current.get(a![0])!, pointers.current.get(b![0])!] as const
      if (press.current) press.current.dragged = true
      update((s) => withView(s, (v, f) => pinch(v, from, to, f), false))
      return
    }
    const p = press.current
    if (!p) return
    if (!p.dragged && Math.hypot(point.x - before.x, point.y - before.y) < DRAG_PX) return
    if (!p.dragged) {
      p.dragged = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    pointers.current.set(e.pointerId, point)
    if (zoom.zoomed) update((s) => withView(s, (v, f) => panBy(v, { x: point.x - before.x, y: point.y - before.y }, f), false))
  }

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
  }

  return (
    <div
      ref={ref}
      data-image-stage=""
      data-zoomed={zoom.zoomed ? "" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClick={() => {
        // A click on the backdrop (not the image, not the end of a drag) closes the modal.
        const p = press.current
        press.current = null
        if (p?.onBackdrop && !p.dragged) closeImageModal()
      }}
      onDoubleClick={(e) => {
        // Only the image gets here: a click on the backdrop has already closed the modal.
        const point = at(e)
        update((s) => withView(s, (v, f) => toggleZoom(v, point, f), true))
      }}
      className={`relative min-h-0 flex-1 touch-none overflow-hidden select-none ${zoom.zoomed ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      {item.kind === "diagram" ? (
        <DiagramSheet key={itemKey} diagram={item} update={update} style={placed} className={placement} />
      ) : (
        <img
          key={itemKey}
          src={item.url}
          alt={item.title}
          draggable={false}
          data-modal-image=""
          onLoad={(e) => {
            const size = { width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }
            update((s) => (s.image ? s : { ...s, image: size }))
          }}
          onError={() => update((s) => ({ ...s, broken: true, view: null }))}
          style={placed}
          className={placement}
        />
      )}
      {zoom.broken ? (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/70">
          <ImageOffIcon aria-hidden className="size-6 text-white/50" />
          {item.kind === "diagram" ? "Couldn't draw this diagram" : "Couldn't load this image"}
        </div>
      ) : null}
    </div>
  )
}

/** A diagram is drawn this many times its size on the page, so its 100% reads like a Retina screenshot of it. */
const DIAGRAM_DENSITY = 2
/** Room around the diagram on its sheet, in drawn px. */
const DIAGRAM_PAD = 32

/**
 * A diagram on a sheet of the page's surface color (light or dark, as the app is), drawn again by
 * Mermaid from its source (its own ids, and again when the theme changes). It stays vector, so the
 * browser redraws it sharp at every zoom; the stage zooms and pans it like an image.
 */
function DiagramSheet({
  diagram,
  update,
  style,
  className,
}: {
  diagram: ModalDiagram
  update: Zoom["update"]
  style: CSSProperties | undefined
  className: string
}) {
  const sheet = useRef<HTMLDivElement>(null)
  const rendered = useDiagram(diagram.source, sheet)
  const svg = rendered !== null && "svg" in rendered ? rendered.svg : null
  const failed = rendered !== null && "error" in rendered

  // Its drawn size is what the zoom maths fit and scale, once it's drawn (and again if a theme draws it another size).
  useEffect(() => {
    const size = svg ? diagramSize(svg) : null
    if (failed || (svg && !size)) update((s) => ({ ...s, broken: true, view: null }))
    else if (size) {
      const drawn = { width: size.width * DIAGRAM_DENSITY + 2 * DIAGRAM_PAD, height: size.height * DIAGRAM_DENSITY + 2 * DIAGRAM_PAD }
      update((s) => (s.image?.width === drawn.width && s.image.height === drawn.height ? s : { ...s, image: drawn, view: null }))
    }
  }, [svg, failed, update])

  return (
    <div
      ref={sheet}
      role="img"
      aria-label={diagram.title}
      data-modal-diagram=""
      data-theme={rendered?.theme}
      style={{ ...style, padding: DIAGRAM_PAD }}
      className={`${className} rounded-xl bg-raised [&>svg]:block [&>svg]:size-full [&>svg]:max-w-none!`}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  )
}
