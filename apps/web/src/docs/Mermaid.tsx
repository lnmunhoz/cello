// Mermaid diagrams, rendered in the browser. The library (mermaid 12.2.0) loads on the first diagram,
// in its own chunk, and renders with `securityLevel: "strict"` (no scripts, sanitized labels). A
// diagram renders again only when its source or the theme changes.
import { useEffect, useState, useSyncExternalStore } from "react"

type MermaidApi = (typeof import("mermaid"))["default"]

let library: Promise<MermaidApi> | null = null
let renders = 0

const FONT = '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

const renderDiagram = async (source: string, dark: boolean): Promise<string> => {
  const mermaid = await (library ??= import("mermaid").then((m) => m.default))
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default", fontFamily: FONT })
  const { svg } = await mermaid.render(`cello-diagram-${++renders}`, source)
  return svg
}

/** The app's theme is a class on <html>; this follows it without polling. */
const subscribeTheme = (onChange: () => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}
const useDark = () => useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains("dark"), () => false)

type Rendered = { readonly svg: string } | { readonly error: string }

export function Mermaid({ source }: { source: string }) {
  const dark = useDark()
  const [rendered, setRendered] = useState<Rendered | null>(null)

  useEffect(() => {
    let current = true
    renderDiagram(source, dark).then(
      (svg) => current && setRendered({ svg }),
      (error: unknown) => current && setRendered({ error: error instanceof Error ? error.message : String(error) }),
    )
    return () => {
      current = false
    }
  }, [source, dark])

  return (
    <figure className="page-diagram" data-mermaid="" aria-busy={rendered === null}>
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
