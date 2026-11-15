import { describe, expect, it } from "vitest"
import { findCelloLink, parseCelloLink, routeCelloLink } from "./celloLink.ts"

describe("parseCelloLink", () => {
  it("turns a task key into the board path of that task", () => {
    expect(parseCelloLink("cello://CEL-3")).toEqual({ kind: "task", path: "/CEL/3" })
    expect(parseCelloLink("cello://thai-12/")).toEqual({ kind: "task", path: "/THAI/12" })
    expect(parseCelloLink("CELLO:CEL-3")).toEqual({ kind: "task", path: "/CEL/3" })
  })

  it("opens an http(s) URL in the panel", () => {
    const url = "https://claude.ai/artifact/RNpQF3GNVbCdMLNVWJqoYh"
    expect(parseCelloLink(`cello://open?url=${encodeURIComponent(url)}`)).toEqual({ kind: "panel", url })
    expect(parseCelloLink(`cello://open?url=${encodeURIComponent("http://localhost:5173")}`)).toEqual({
      kind: "panel",
      url: "http://localhost:5173/",
    })
  })

  it("refuses anything else", () => {
    for (const bad of [
      "cello://open",
      `cello://open?url=${encodeURIComponent("javascript:alert(1)")}`,
      `cello://open?url=${encodeURIComponent("file:///etc/passwd")}`,
      "cello://CEL-0",
      "cello://not a key",
      "cello://",
      "https://claude.ai",
      "garbage",
    ]) {
      expect(parseCelloLink(bad), bad).toBeNull()
    }
  })
})

describe("routeCelloLink: where a link goes once the board is up (CEL-60)", () => {
  const BOARD = "http://127.0.0.1:4747"

  it("a Cello page goes to the board window, which opens it in its own side panel, not the built-in browser", () => {
    const page = "http://127.0.0.1:4747/CEL/pages/billing-audit"
    expect(routeCelloLink(parseCelloLink(`cello://open?url=${encodeURIComponent(page)}`)!, BOARD)).toEqual({ kind: "board", url: page })
    const section = "http://127.0.0.1:4747/CEL/pages/billing-audit?version=2#next-steps"
    expect(routeCelloLink({ kind: "panel", url: section }, BOARD)).toEqual({ kind: "board", url: section })
  })

  it("a stored text file on the board goes to the board window too", () => {
    expect(routeCelloLink({ kind: "panel", url: "http://127.0.0.1:4747/attachments/f1" }, BOARD)).toEqual({
      kind: "board",
      url: "http://127.0.0.1:4747/attachments/f1",
    })
  })

  it("an outside site, a dev server on another port included, stays in the built-in browser", () => {
    expect(routeCelloLink({ kind: "panel", url: "https://claude.ai/artifact/x" }, BOARD)).toEqual({ kind: "panel", url: "https://claude.ai/artifact/x" })
    expect(routeCelloLink({ kind: "panel", url: "http://127.0.0.1:5173/" }, BOARD)).toEqual({ kind: "panel", url: "http://127.0.0.1:5173/" })
  })

  it("a task still goes to the board at its path", () => {
    expect(routeCelloLink({ kind: "task", path: "/CEL/3" }, BOARD)).toEqual({ kind: "task", path: "/CEL/3" })
  })
})

describe("findCelloLink", () => {
  it("finds the link a second launch was given among its arguments", () => {
    expect(findCelloLink(["/Applications/Cello.app/Contents/MacOS/Cello", "--flag", "cello://CEL-3"])).toBe("cello://CEL-3")
    expect(findCelloLink(["electron", "."])).toBeUndefined()
  })
})
