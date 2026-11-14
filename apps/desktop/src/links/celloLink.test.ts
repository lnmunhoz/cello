import { describe, expect, it } from "vitest"
import { findCelloLink, parseCelloLink } from "./celloLink.ts"

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

describe("findCelloLink", () => {
  it("finds the link a second launch was given among its arguments", () => {
    expect(findCelloLink(["/Applications/Cello.app/Contents/MacOS/Cello", "--flag", "cello://CEL-3"])).toBe("cello://CEL-3")
    expect(findCelloLink(["electron", "."])).toBeUndefined()
  })
})
