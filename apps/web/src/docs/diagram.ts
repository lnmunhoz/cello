// A rendered Mermaid diagram's name and size, read from its SVG: pure, so the page's diagram and the
// image modal's copy agree on both.
import type { Size } from "../lib/zoom.ts"

const MAX_LABEL = 60

/** "Diagram: " and the diagram's first label on one line, cut short; just "Diagram" without one. */
export const diagramTitle = (label: string | null | undefined): string => {
  const line = (label ?? "").replace(/\s+/g, " ").trim()
  if (line === "") return "Diagram"
  return `Diagram: ${line.length > MAX_LABEL ? `${line.slice(0, MAX_LABEL - 1).trimEnd()}…` : line}`
}

const attribute = (svg: string, name: string): string | undefined => {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? ""
  return new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1]
}

const positive = (width: number, height: number): Size | null =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null

/** The size Mermaid drew the diagram at, in CSS px: its viewBox, else its numeric width and height. */
export const diagramSize = (svg: string): Size | null => {
  const box = attribute(svg, "viewBox")?.trim().split(/[\s,]+/).map(Number)
  if (box?.length === 4) return positive(box[2]!, box[3]!)
  const width = attribute(svg, "width")
  const height = attribute(svg, "height")
  if (!width || !height || !/^[\d.]+(px)?$/.test(width) || !/^[\d.]+(px)?$/.test(height)) return null
  return positive(parseFloat(width), parseFloat(height))
}
