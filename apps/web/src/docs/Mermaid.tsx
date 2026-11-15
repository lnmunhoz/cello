// Mermaid diagrams, rendered in the browser. The library (mermaid 12.2.0) loads on the first diagram,
// in its own chunk, and renders with `securityLevel: "strict"` (no scripts, sanitized labels); the
// rest of the config is in mermaidConfig.ts. A diagram renders again only when its source or the
// theme changes. A rendered diagram is a button that opens it in the image modal (`useDiagram` draws
// the modal's copy), with the other images and diagrams of its page or packet.
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react"
import { openGallery, zoomable } from "../viewer/gallery.ts"
import { diagramTitle } from "./diagram.ts"
import { backgroundOf, mermaidConfig } from "./mermaidConfig.ts"
import { RenderSkipped, renderQueue } from "./renderQueue.ts"

type MermaidApi = (typeof import("mermaid"))["default"]

let library: Promise<MermaidApi> | null = null
let renders = 0
/** One at a time (`initialize` sets Mermaid's global config, so another diagram's call mid-render would change this one's), 10 s each. */
const enqueue = renderQueue(10_000)

/** The library, loaded once; a failed load (say, a chunk gone after a deploy) is tried again next time. */
const loadMermaid = () =>
  (library ??= import("mermaid").then(
    (m) => m.default,
    (error: unknown) => {
      library = null
      throw error
    },
  ))

// Each render gets its own ids (`cello-diagram-<n>`), so a page's diagram and the modal's copy never share one.
const renderDiagram = (source: string, dark: boolean, background: string, wanted: () => boolean): Promise<string> =>
  enqueue(async () => {
    const mermaid = await loadMermaid()
    mermaid.initialize(mermaidConfig({ dark, background }))
    const { svg } = await mermaid.render(`cello-diagram-${++renders}`, source)
    return svg
  }, wanted)

/** The colors behind an element, from it outward, as the browser computes them. */
const backgroundsFrom = (element: Element | null): string[] => {
  const colors: string[] = []
  for (let e = element; e !== null; e = e.parentElement) colors.push(getComputedStyle(e).backgroundColor)
  return colors
}

/** Where a label sits, most telling first: a flowchart's or state's node, a sequence's actor, then any text. */
const LABELS = ["g.node .nodeLabel", "g.node text", "text.actor", ".nodeLabel", "text"]

/** The diagram's first label (a subgraph's or an edge's comes after the nodes'), lines joined by spaces. */
const firstLabel = (svg: string): string | null => {
  const doc = new DOMParser().parseFromString(svg, "text/html")
  for (const selector of LABELS) {
    for (const label of doc.querySelectorAll(selector)) {
      for (const br of label.querySelectorAll("br")) br.replaceWith(" ")
      const text = label.textContent?.trim()
      if (text) return text
    }
  }
  return null
}

/** The app's theme is a class on <html>; this follows it without polling. */
const subscribeTheme = (onChange: () => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}
const useDark = () => useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains("dark"), () => false)

export type RenderedDiagram = ({ readonly svg: string; readonly title: string } | { readonly error: string }) & { readonly theme: "light" | "dark" }

/**
 * `source` drawn in the current theme, again whenever the theme changes; null until it's drawn. Edge
 * labels get the color behind `surface` (the element it's drawn on), read once the theme's class is on <html>.
 */
export function useDiagram(source: string, surface: RefObject<HTMLElement | null>): RenderedDiagram | null {
  const dark = useDark()
  const [rendered, setRendered] = useState<RenderedDiagram | null>(null)

  useEffect(() => {
    let current = true
    const theme = dark ? "dark" : "light"
    // A render still queued when this diagram unmounts or its theme changes is skipped.
    renderDiagram(source, dark, backgroundOf(backgroundsFrom(surface.current), dark ? "#1c1c1f" : "#ffffff"), () => current).then(
      (svg) => current && setRendered({ svg, title: diagramTitle(firstLabel(svg)), theme }),
      (error: unknown) =>
        current && !(error instanceof RenderSkipped) && setRendered({ error: error instanceof Error ? error.message : String(error), theme }),
    )
    return () => {
      current = false
    }
  }, [source, dark, surface])

  return rendered
}

export function Mermaid({ source }: { source: string }) {
  const figure = useRef<HTMLElement>(null)
  const rendered = useDiagram(source, figure)

  return (
    <figure ref={figure} className="page-diagram" data-mermaid="" data-theme={rendered?.theme} aria-busy={rendered === null}>
      {rendered !== null && "svg" in rendered ? (
        // Click or Enter: the image modal, fitted, with the page's or packet's other images and diagrams.
        <button
          type="button"
          aria-label={rendered.title}
          title="Open the diagram large"
          {...zoomable({ kind: "diagram", source, title: rendered.title })}
          onClick={(e) => openGallery(e.currentTarget)}
          className="block w-full cursor-zoom-in rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div dangerouslySetInnerHTML={{ __html: rendered.svg }} />
        </button>
      ) : null}
      {rendered !== null && "error" in rendered ? (
        <>
          <figcaption>This diagram didn’t render: {rendered.error}</figcaption>
          <pre>{source}</pre>
        </>
      ) : null}
    </figure>
  )
}
