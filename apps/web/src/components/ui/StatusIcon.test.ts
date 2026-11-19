import type { StatusCategory } from "@cello/contract/entities"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { StatusIcon } from "./StatusIcon.tsx"

/** The glyph's markup. Tests read it as text: there is no DOM in the unit tests. */
const render = (category: StatusCategory) => renderToStaticMarkup(createElement(StatusIcon, { category, color: "#8B5CF6" }))

describe("StatusIcon", () => {
  it("every category the server stores draws a glyph", () => {
    for (const category of ["backlog", "unstarted", "started", "waiting", "completed", "canceled"] as const) {
      expect(render(category)).toContain("<svg")
    }
  })

  it("a category this build doesn't know (other, CEL-178) draws a plain ring in the status colour, like Todo", () => {
    const html = render("other")
    expect(html).toContain("<svg")
    expect(html).toContain('stroke="#8B5CF6"')
    expect(html).toContain("<circle")
    expect(html).not.toContain("<path")
    expect(html).toBe(render("unstarted"))
  })
})
