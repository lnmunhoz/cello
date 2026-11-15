// How Cello draws Mermaid diagrams. These are site defaults: a diagram's own `%%{init: …}%%` directive
// or frontmatter `config:` overrides any of them, except the security keys Mermaid never lets a
// diagram change (securityLevel among them).
import type { MermaidConfig } from "mermaid"

const FONT = '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

export const mermaidConfig = ({ dark, background }: { readonly dark: boolean; readonly background: string }) =>
  ({
    startOnLoad: false,
    // No scripts or click handlers, and labels are sanitized: pages and packets come from agents.
    securityLevel: "strict",
    theme: dark ? "dark" : "default",
    fontFamily: FONT,
    // Mermaid gives an edge label ("Yes", "No") a grey box; the color behind the diagram hides the line
    // under the label without drawing a box, in either theme.
    themeVariables: { edgeLabelBackground: background },
    // Mermaid 12 wraps labels at 120 px, which stacks a sentence into a tall, narrow box.
    flowchart: { wrappingWidth: 280, nodeSpacing: 40, rankSpacing: 48 },
    // Mermaid's default layout (ELK) breaks a loop where it likes, which can put the start of a
    // `flowchart TD` at the bottom. By the order nodes are written, the first one stays on top and a
    // loop back to it is drawn as an arrow going up.
    elk: { cycleBreakingStrategy: "MODEL_ORDER" },
  }) satisfies MermaidConfig

const transparent = (color: string) => color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color.replace(/\s+/g, " "))

/** The color behind a diagram: the first background, from its figure outward, that isn't transparent. */
export const backgroundOf = (colors: ReadonlyArray<string>, fallback = "transparent") => colors.find((c) => !transparent(c)) ?? fallback
