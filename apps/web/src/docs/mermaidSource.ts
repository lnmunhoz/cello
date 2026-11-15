// A ```mermaid block's source, from the children react-markdown gives a <pre>; null for other blocks.
// Pages (Prose) and packet summaries, comments and descriptions (Markdown) both draw these as diagrams.
import { Children, isValidElement, type ReactNode } from "react"

export const mermaidSource = (children: ReactNode): string | null => {
  const code = Children.toArray(children)[0]
  if (!isValidElement<{ className?: string; children?: ReactNode }>(code)) return null
  if (!code.props.className?.split(" ").includes("language-mermaid")) return null
  return String(code.props.children ?? "").replace(/\n$/, "")
}
