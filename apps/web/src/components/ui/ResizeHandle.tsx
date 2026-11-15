import { useState } from "react"
import { dragWidth, keyWidth, readWidth, type Edge, type WidthRule } from "../../lib/resize.ts"
import { readStored, writeStored } from "../../lib/storage.ts"
import { variants } from "./variants.ts"

/**
 * A panel's width that the person resizes, remembered on this device under `key`. The setter saves
 * when asked (at the end of a drag, on a key press), not on every move.
 */
export function useStoredWidth(key: string, rule: WidthRule): readonly [number, (width: number, persist: boolean) => void] {
  const [width, setWidth] = useState(() => readWidth(readStored(key), rule))
  const resize = (next: number, persist: boolean) => {
    setWidth(next)
    if (persist) writeStored(key, String(next))
  }
  return [width, resize]
}

const handle = variants(
  "absolute inset-y-0 z-20 w-2 cursor-col-resize outline-none hover:bg-accent/30 focus-visible:bg-accent/40 data-resizing:bg-accent/40",
  { edge: { left: "-left-1", right: "-right-1" } },
  { edge: "left" },
)

/**
 * The edge of a panel you drag, or move with ← and →, to resize it: the viewer's left edge, the
 * sidebar's right one. Put it inside the panel (positioned); the panel's parent is the container the
 * width is limited against. While dragging, a layer over the whole window keeps the pointer from
 * being swallowed by an iframe (a Cello page or a site in the viewer).
 */
export function ResizeHandle({
  edge,
  label,
  rule,
  width,
  onResize,
}: {
  edge: Edge
  label: string
  rule: WidthRule
  width: number
  onResize: (width: number, persist: boolean) => void
}) {
  const [drag, setDrag] = useState<{ width: number; x: number } | null>(null)
  const container = (el: HTMLElement) => el.parentElement?.parentElement?.clientWidth ?? window.innerWidth
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={rule.min}
        aria-valuemax={rule.max}
        tabIndex={0}
        data-resizing={drag ? "" : undefined}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag({ width, x: e.clientX })
        }}
        onPointerMove={(e) => {
          if (drag) onResize(dragWidth(drag, e.clientX, edge, rule, container(e.currentTarget)), false)
        }}
        onPointerUp={(e) => {
          if (!drag) return
          onResize(dragWidth(drag, e.clientX, edge, rule, container(e.currentTarget)), true)
          setDrag(null)
        }}
        onLostPointerCapture={() => setDrag(null)}
        onKeyDown={(e) => {
          const next = keyWidth(e.key, width, edge, rule, container(e.currentTarget))
          if (next === null) return
          e.preventDefault()
          onResize(next, true)
        }}
        className={handle({ edge })}
      />
      {drag ? <div aria-hidden className="fixed inset-0 z-50 cursor-col-resize" /> : null}
    </>
  )
}
