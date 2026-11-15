import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { WorkspaceMark } from "./WorkspaceMark.tsx"

describe("WorkspaceMark", () => {
  it("shows the workspace's first letter", () => {
    expect(renderToStaticMarkup(createElement(WorkspaceMark, { name: "personal" }))).toContain(">P<")
  })

  it("shows the Cello icon, not a placeholder letter, while no workspace has loaded (CEL-27)", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceMark, {}))
    expect(html).toContain('src="/icons/icon.svg"')
    expect(html).not.toContain(">C<")
  })
})
