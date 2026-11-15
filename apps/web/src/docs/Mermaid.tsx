// Mermaid diagrams, rendered in the browser. The library (mermaid 12.2.0) loads on the first diagram,
// in its own chunk, and renders with `securityLevel: "strict"` (no scripts, sanitized labels); the
// rest of the config is in mermaidConfig.ts. A diagram renders again only when its source or the
// theme changes.
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { backgroundOf, mermaidConfig } from "./mermaidConfig.ts"

type MermaidApi = (typeof import("mermaid"))["default"]

let library: Promise<MermaidApi> | null = null
let renders = 0
/** Renders one at a time: `initialize` sets Mermaid's global config, so another diagram's call mid-render would change this one's. */
let queue: Promise<unknown> = Promise.resolve()

const renderDiagram = (source: string, dark: boolean, background: string): Promise<string> => {
  const next = queue.then(async () => {
    const mermaid = await (library ??= import("mermaid").then((m) => m.default))
    mermaid.initialize(mermaidConfig({ dark, background }))
    const { svg } = await mermaid.render(`cello-diagram-${++renders}`, source)
    return svg
  })
  queue = next.catch(() => undefined)
  return next
}

/** The colors behind an element, from it outward, as the browser computes them. */
const backgroundsFrom = (element: Element | null): string[] => {
  const colors: string[] = []
  for (let e = element; e !== null; e = e.parentElement) colors.push(getComputedStyle(e).backgroundColor)
  return colors
}

/** The app's theme is a class on <html>; this follows it without polling. */
const subscribeTheme = (onChange: () => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}
const useDark = () => useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains("dark"), () => false)

type Rendered = ({ readonly svg: string } | { readonly error: string }) & { readonly theme: "light" | "dark" }

export function Mermaid({ source }: { source: string }) {
  const dark = useDark()
  const figure = useRef<HTMLElement>(null)
  const [rendered, setRendered] = useState<Rendered | null>(null)

  useEffect(() => {
    let current = true
    const theme = dark ? "dark" : "light"
    // Edge labels get the color behind the diagram, read now that the theme's class is on <html>.
    renderDiagram(source, dark, backgroundOf(backgroundsFrom(figure.current), dark ? "#1c1c1f" : "#ffffff")).then(
      (svg) => current && setRendered({ svg, theme }),
      (error: unknown) => current && setRendered({ error: error instanceof Error ? error.message : String(error), theme }),
    )
    return () => {
      current = false
    }
  }, [source, dark])

  return (
    <figure ref={figure} className="page-diagram" data-mermaid="" data-theme={rendered?.theme} aria-busy={rendered === null}>
      {rendered !== null && "svg" in rendered ? <div role="img" aria-label="Diagram" dangerouslySetInnerHTML={{ __html: rendered.svg }} /> : null}
      {rendered !== null && "error" in rendered ? (
        <>
          <figcaption>This diagram didn’t render: {rendered.error}</figcaption>
          <pre>{source}</pre>
        </>
      ) : null}
    </figure>
  )
}
