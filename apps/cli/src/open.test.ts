import { describe, expect, it } from "vitest"
import { openerCommand, openTarget } from "./open.ts"

const PAGE = "http://127.0.0.1:4747/CEL/pages/billing-audit"
const PAGE_LINK = `cello://open?url=${encodeURIComponent(PAGE)}`

describe("openTarget: what `cello open` was given (CEL-88)", () => {
  it("a page's address becomes its cello://open link", () => {
    expect(openTarget(PAGE)).toEqual({ kind: "page", link: PAGE_LINK, url: PAGE })
    expect(openTarget("https://claude.ai/artifact/x")).toEqual({
      kind: "page",
      link: `cello://open?url=${encodeURIComponent("https://claude.ai/artifact/x")}`,
      url: "https://claude.ai/artifact/x",
    })
  })

  it("a task key in capitals becomes cello://<KEY>", () => {
    expect(openTarget("CEL-12")).toEqual({ kind: "task", link: "cello://CEL-12", key: "CEL-12" })
  })

  it("a cello:// link is taken as it is, written the one way", () => {
    expect(openTarget(PAGE_LINK)).toEqual({ kind: "page", link: PAGE_LINK, url: PAGE })
    expect(openTarget("cello://cel-12")).toEqual({ kind: "task", link: "cello://CEL-12", key: "CEL-12" })
  })

  it("a slug is a page of the project, looked up on the server; slugs are lower case, so cel-12 is one", () => {
    expect(openTarget("billing-audit")).toEqual({ kind: "slug", slug: "billing-audit" })
    expect(openTarget("cel-12")).toEqual({ kind: "slug", slug: "cel-12" })
  })

  it("anything else is nothing it can open", () => {
    for (const bad of ["", "Billing Audit", "file:///etc/passwd", "javascript:alert(1)", "cello://open", "ftp://example.com/x"]) {
      expect(openTarget(bad), bad).toBeNull()
    }
  })
})

describe("openerCommand: how the system opens a link", () => {
  it("is `open` on macOS and `xdg-open` on Linux", () => {
    expect(openerCommand("darwin", "cello://CEL-12")).toEqual(["open", "cello://CEL-12"])
    expect(openerCommand("linux", "cello://CEL-12")).toEqual(["xdg-open", "cello://CEL-12"])
  })

  it("is nothing elsewhere", () => {
    expect(openerCommand("win32", "cello://CEL-12")).toBeNull()
  })
})
