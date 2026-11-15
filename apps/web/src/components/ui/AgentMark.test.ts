import { readFileSync } from "node:fs"
import { AGENT_BODY, AGENT_CENTER, AGENT_HAPPY_EYES, AGENT_SPINNER_BODY, agentFramePoint } from "@cello/shared/agentMark"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AgentMark, type AgentMarkProps } from "./AgentMark.tsx"

/** The mark's markup. Tests read it as text: there is no DOM in the unit tests. */
const render = (props: AgentMarkProps = {}) => renderToStaticMarkup(createElement(AgentMark, props))
const css = readFileSync(new URL("./AgentMark.css", import.meta.url), "utf8")

describe("AgentMark (CEL-69)", () => {
  it("draws the icon's body and two eyes, still, at 16 px unless told otherwise", () => {
    const html = render()
    expect(html).toContain('data-agent-mood="still"')
    expect(html).toContain(`<path d="${AGENT_BODY}"`)
    expect(html.match(/<rect /g)).toHaveLength(2)
    expect(html).toMatch(/style="width:16px;height:16px"/)
    expect(html).toContain('aria-hidden="true"')
    expect(render({ size: 24 })).toMatch(/style="width:24px;height:24px/)
  })

  it("takes any colour for the body and the eyes, as CSS variables, so one mark draws in a session's colour, the brand or ink", () => {
    const html = render({ body: "#8B5CF6", eye: "white" })
    expect(html).toContain("--agent-body:#8B5CF6")
    expect(html).toContain("--agent-eye:white")
    // Unset, it inherits the variables from the page (or the text colour): nothing inline.
    expect(render()).not.toContain("--agent-body")
    expect(css).toMatch(/fill: var\(--agent-body, currentColor\)/)
  })

  it("spins a shorter tip while working, and draws the plain body in every other mood", () => {
    expect(render({ mood: "working" })).toContain(`<path d="${AGENT_SPINNER_BODY}"`)
    for (const mood of ["still", "thinking", "waiting", "done", "merged"] as const) expect(render({ mood })).toContain(`<path d="${AGENT_BODY}"`)
  })

  it("draws the happy eyes only when it can show them (Done, Merged), and the ring only for Needs input", () => {
    for (const mood of ["done", "merged"] as const) expect(render({ mood })).toContain(`d="${AGENT_HAPPY_EYES}"`)
    for (const mood of ["still", "working", "thinking", "waiting"] as const) expect(render({ mood })).not.toContain(AGENT_HAPPY_EYES)
    expect(render({ mood: "waiting" })).toContain("am-ring")
    expect(render({ mood: "done" })).not.toContain("am-ring")
  })

  it("marks an entry to play only when asked, and carries data attributes through", () => {
    expect(render({ mood: "done", play: true })).toContain("data-play")
    expect(render({ mood: "done" })).not.toContain("data-play")
    expect(render({ "data-presence": "active" })).toContain('data-presence="active"')
  })

  it("brings no style element of its own: the keyframes live once in AgentMark.css", () => {
    expect(render({ mood: "working" })).not.toContain("<style")
  })
})

describe("AgentMark.css", () => {
  /** Every declaration inside the stylesheet's @keyframes blocks. */
  const keyframeProperties = () =>
    [...css.matchAll(/@keyframes [\w-]+ \{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)].flatMap((block) =>
      [...block[1]!.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]!),
    )

  it("animates only transform and opacity, which the compositor runs off the main thread", () => {
    const properties = keyframeProperties()
    expect(properties.length).toBeGreaterThan(20)
    expect(new Set(properties)).toEqual(new Set(["transform", "opacity"]))
  })

  it("turns and squashes about the icon's own points: the circle's centre and the floor under it", () => {
    const center = agentFramePoint(AGENT_CENTER)
    expect(css).toContain(`--am-cx: ${center.x}%;`)
    expect(css).toContain(`--am-cy: ${center.y}%;`)
    expect(css).toContain(`--am-eyes-y: ${agentFramePoint({ x: 0, y: AGENT_CENTER.y + 5 }).y}%;`)
    expect(css).toContain(`--am-floor: ${agentFramePoint({ x: 0, y: AGENT_CENTER.y + 270 }).y}%;`)
  })

  it("stops every animation for prefers-reduced-motion, letting a one-off end at once so a leaving mark still leaves", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"))
    expect(reduced).toContain("animation-duration: 1ms !important")
    expect(reduced).toContain("animation-iteration-count: 1 !important")
  })
})
